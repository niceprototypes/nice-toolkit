/**
 * @fileoverview The `nicely develop` view: dev-runner's reporter, drawn as a live tree.
 *
 * Owns the tree model and its output. dev-runner calls the reporter methods (a watcher
 * started, printed a line, ended a cycle); the reload watcher calls `reloadPing`.
 * - TTY: the tree (`tree-view`) is redrawn in place through the live region at up to 10 fps.
 * - Non-TTY (CI, pipes): one line per state change, failed builds' diagnostics in full.
 * A cycle's end is held for `settleMs`: rollup's watch reruns the declaration bundle right after
 * a build (its own dist/types change), and that burst belongs to the same build. Output inside
 * the window continues the cycle; the worst outcome of the burst wins.
 * `verbose`: each finished build's row and all its steps are printed once (to the scrollback on a
 * TTY, under its line otherwise); the live tree keeps only what is still building or failed.
 * `done()` stops the redraw and releases the terminal (cursor shown) before shutdown output.
 *
 * @module cli/develop/develop-view
 */

const { createTreeModel } = require('./tree-model');
const { feedEvents } = require('./lifecycle');
const { toLines, finishedLines, shortName, seconds } = require('./tree-view');
const { createLiveRegion } = require('../../shared/live-region');
const { HEART } = require('../../shared/palette');
const { gray, yellow, red, green } = require('../../shared/logger');

const REDRAW_MS = 100;
const SETTLE_MS = 400;
const WORSE = { ready: 0, failed: 1, exited: 2 };

/**
 * @param {object} [options]
 * @param {NodeJS.WriteStream} [options.stream=process.stdout]
 * @param {() => number} [options.now]
 * @param {number} [options.settleMs=400] - 0 settles at once
 * @param {boolean} [options.verbose=false]
 */
function createDevelopView({ stream = process.stdout, now = Date.now, settleMs = SETTLE_MS, verbose = false } = {}) {
  const model = createTreeModel(now);
  const isTTY = Boolean(stream.isTTY);
  const region = isTTY ? createLiveRegion({ stream }) : null;
  const write = (line) => stream.write(`${line}\n`);
  let timer = null;
  let released = false;
  /** Cycle ends held for `settleMs`, per package: { outcome, timer, settle } */
  const pending = new Map();

  const frame = () => toLines(model, now(), { rows: stream.rows || 40, verbose });
  const redraw = () => region.render(frame());

  /** Non-TTY: the line for a package's settled cycle, plus its diagnostics when it failed. */
  const writeSettled = (entry) => {
    const timing = `${seconds(entry.duration)}`;
    const { outcome } = entry;
    if (outcome.kind === 'failed') {
      write(`${red('✗')} ${shortName(entry.name)}  ${outcome.detail}`);
      for (const line of entry.pinned) write(`    ${line}`);
    } else if (outcome.kind === 'warned') {
      write(`${yellow('⚠')} ${shortName(entry.name)}  Built in ${timing}, ${outcome.count} warning${outcome.count === 1 ? '' : 's'}`);
    } else {
      write(`${green('✓')} ${shortName(entry.name)}  Built in ${timing}`);
    }
  };

  return {
    /** The packages about to run, in display order, each with its dependencies among them. */
    begin(graph, order) {
      for (const name of order) model.register(name, graph.get(name));
      if (isTTY) {
        redraw();
        timer = setInterval(redraw, REDRAW_MS);
      }
    },

    starting(names, waitedFor) {
      for (const name of names) model.cycleStart(name);
      if (!isTTY) write(`${HEART} Starting ${names.map(shortName).join(', ')}${waitedFor.length ? gray(` (after ${waitedFor.map(shortName).join(', ')})`) : ''}`);
    },

    output(name, line, events) {
      // Output inside the settle window: the same build continues
      if (pending.has(name) && events.length > 0) clearTimeout(pending.get(name).timer);
      const wasBuilding = model.get(name)?.state === 'building';
      feedEvents(model, name, line, events);
      if (!isTTY && !wasBuilding && model.get(name)?.state === 'building') write(`${HEART} ${shortName(name)}  Rebuilding`);
    },

    cycle(name, outcome, info = {}) {
      const held = pending.get(name);
      if (held) {
        clearTimeout(held.timer);
        if (WORSE[held.outcome] > WORSE[outcome]) outcome = held.outcome;
      }
      const settle = () => {
        clearTimeout(pending.get(name)?.timer);
        pending.delete(name);
        model.settle(name, outcome, info);
        const entry = model.get(name);
        if (!isTTY) writeSettled(entry);
        if (!verbose) return;
        const [row, ...steps] = finishedLines(model, entry, now());
        if (isTTY) {
          region.printAbove([row, ...steps]);
          redraw();
        } else {
          for (const line of steps) write(line);
        }
      };
      if (settleMs === 0 || outcome === 'exited') return settle();
      pending.set(name, { outcome, settle, timer: setTimeout(settle, settleMs) });
    },

    // The tree shows a slow or failed first build in its row already
    firstBuild() {},

    dependencyCycle(names) {
      if (!isTTY) write(`${yellow('⚠')} Dependency cycle among ${names.map(shortName).join(', ')}: starting them together`);
    },

    allBuilt(count, ms) {
      // The last first build may still be held in its settle window: report it first
      for (const held of [...pending.values()]) held.settle();
      model.allBuilt(ms);
      if (!isTTY) write(`${green('✓')} All ${count} packages built once in ${seconds(ms)}`);
    },

    /** The reload watcher touched the consumer's trigger file for `name`. */
    reloadPing(name, fileCount) {
      model.reloadPing(name);
      if (!isTTY) write(gray(`Reloaded ${shortName(name)} (${fileCount} file${fileCount === 1 ? '' : 's'})`));
    },

    /** Stops redrawing and releases the terminal, leaving the last frame on screen. */
    done() {
      if (released) return;
      released = true;
      clearInterval(timer);
      for (const held of pending.values()) clearTimeout(held.timer);
      if (region) region.done(frame());
    },
  };
}

module.exports = { createDevelopView };
