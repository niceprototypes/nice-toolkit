/**
 * @fileoverview Detects when each of a package's dev-watcher build cycles ends.
 *
 * Fed the parser events (`dev-output-parser`) of one watcher. A cycle ends when:
 * - the tool says it is idle (a `cycle-end`: rollup "waiting for changes", tsc
 *   "Watching for file changes");
 * - or, for tools with no idle line (tsup, the icons generator), every build it
 *   started has finished and it has printed nothing for `quietMs`. A tsc compile
 *   (`compile` build-start) is finished only by tsc's idle line: nice-styles runs tsc
 *   beside generators that finish in seconds, and their quiet must not end the cycle
 *   while tsc is still writing dist/. tsup starts its
 *   DTS build a moment after the ESM build succeeds, so "nothing in flight" alone is
 *   not enough. The first cycle also needs a finished step first (a tool's banner and
 *   its first compile can be silent); later cycles end on quiet after any output;
 * - or its process exits (final: no further cycles are reported).
 * A cycle that reported an error ends as `failed`.
 *
 * dev-runner's start order waits for the first cycle; the develop view settles every cycle.
 *
 * @module cli/develop/cycle-tracker
 */

/**
 * @typedef {'ready'|'failed'|'exited'} CycleOutcome
 */

/**
 * @param {object} options
 * @param {(outcome: CycleOutcome) => void} options.onCycle - Called at the end of every cycle.
 * @param {number} [options.quietMs=1500] - Silence that ends a cycle with no idle line.
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 * @returns {{ feed: (events: import('./dev-output-parser').ParseEvent[]) => void, exit: () => void }}
 */
function createCycleTracker({ onCycle, quietMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let exited = false;
  let cycles = 0;
  let active = false;
  let inFlight = 0;
  let compiling = false;
  let progressed = false;
  let failed = false;
  let timer = null;

  const finish = (outcome) => {
    clearTimer(timer);
    timer = null;
    const result = failed && outcome === 'ready' ? 'failed' : outcome;
    cycles++;
    active = false;
    inFlight = 0;
    compiling = false;
    progressed = false;
    failed = false;
    onCycle(result);
  };

  // Every line restarts the quiet window; it only runs once nothing is in flight.
  const armQuiet = () => {
    clearTimer(timer);
    const quietEnds = inFlight === 0 && !compiling && (progressed || (cycles > 0 && active));
    timer = quietEnds ? setTimer(() => finish('ready'), quietMs) : null;
  };

  return {
    feed(events) {
      if (exited || events.length === 0) return;
      active = true;
      for (const event of events) {
        switch (event.type) {
          case 'build-start':
            if (event.compile) compiling = true;
            else inFlight++;
            break;
          case 'sub':
            // A finished step (rollup "created", tsup "Build success", "✓ Generated")
            if (event.state === 'done') {
              inFlight = Math.max(0, inFlight - 1);
              progressed = true;
            }
            break;
          case 'error':
            failed = true;
            progressed = true;
            inFlight = Math.max(0, inFlight - 1);
            break;
          case 'cycle-end':
            finish('ready');
            return;
        }
      }
      armQuiet();
    },
    exit() {
      if (exited) return;
      exited = true;
      finish('exited');
    },
  };
}

module.exports = { createCycleTracker };
