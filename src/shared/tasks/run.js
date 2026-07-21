/**
 * @fileoverview `runTasks` — the standardized runner. Takes a strictly-typed
 * array of tasks, drives each through the reporter, and returns an aggregated
 * report. This is the shared spine the terminal scripts (build/reset, unlink,
 * dedupe, clean, peer-deps) collapse onto: each script supplies only its typed
 * task array; the spinner, iconography, failure output, and tally live here.
 *
 * Lazy spinner: a task whose `run()` returns synchronously (an instant skip/
 * decision) is rendered with no animation; only a task that returns a Promise
 * engages the heart spinner. This preserves byte-parity with the hand-rolled
 * output — instant skips never flashed a `♥ …` line, and off-TTY they must not
 * add one to the logs.
 *
 * Scheduling is sequential today (all seven terminal scripts run their lists in
 * order). Concurrent scheduling is deliberately deferred: it belongs with the
 * multi-region live reporter that develop requires, and forcing a half-built
 * parallel path now would pre-commit that unmade design.
 *
 * @module shared/tasks/run
 */

const { formatOutcome } = require('./status');
const { createReporter } = require('./reporter');

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Per-task context handed to `run()`. Minimal by design for the terminal
 * scripts; the streaming `line()` sink and richer lifecycle hooks arrive with
 * the concurrent scripts, behind this same object.
 * @typedef {object} TaskContext
 * @property {AbortSignal | undefined} signal - Cooperative-cancel signal (e.g. Ctrl+C).
 */

/**
 * A single unit of orchestrated work.
 * @template [T=unknown]
 * @typedef {object} Task
 * @property {string} label - Display name (the persistent line's subject).
 * @property {string} [activeLabel] - Phrase beside the spinner while in flight
 *   (e.g. "Building nice-styles"); defaults to `label`.
 * @property {(ctx: TaskContext) => import('./status').Outcome | Promise<import('./status').Outcome>} run
 *   Performs the work and reports a terminal outcome. Return synchronously for
 *   an instant decision (skip); return a Promise to engage the spinner. A throw
 *   is caught and rendered as a `failed` outcome.
 */

/**
 * The aggregate result: package labels bucketed by outcome kind, plus the full
 * outcome map for callers that need details (e.g. reset-log capture).
 * @typedef {object} Report
 * @property {string[]} done
 * @property {string[]} skipped
 * @property {string[]} failed
 * @property {Map<string, import('./status').Outcome>} outcomes
 */

// ──────────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs a typed task list sequentially, rendering each through the reporter, and
 * prints the summary tally.
 *
 * @template T
 * @param {ReadonlyArray<Task<T>>} tasks
 * @param {object} [opts]
 * @param {string} [opts.verb='done'] - Summary verb ("built", "would build", …).
 * @param {import('./reporter').Reporter} [opts.reporter] - Override the reporter.
 * @param {AbortSignal} [opts.signal] - Forwarded to every task's context.
 * @param {boolean} [opts.summary=true] - Print the tally line when done.
 * @returns {Promise<Report>}
 */
async function runTasks(tasks, { verb = 'done', reporter = createReporter(), signal, summary = true } = {}) {
  /** @type {Report} */
  const report = { done: [], skipped: [], failed: [], outcomes: new Map() };
  /** @type {TaskContext} */
  const ctx = { signal };

  for (const task of tasks) {
    const outcome = await settle(task, ctx, reporter);

    report.outcomes.set(task.label, outcome);
    report[outcome.kind].push(task.label);

    // A failed task may carry captured output to print beneath its line.
    if (outcome.kind === 'failed' && outcome.output) reporter.raw(outcome.output);
  }

  if (summary) reporter.summary(report, verb);
  return report;
}

/**
 * Runs one task to its terminal outcome and renders it — spinner only if the
 * work is actually asynchronous.
 *
 * @param {Task} task
 * @param {TaskContext} ctx
 * @param {import('./reporter').Reporter} reporter
 * @returns {Promise<import('./status').Outcome>}
 */
async function settle(task, ctx, reporter) {
  let started;
  try {
    started = task.run(ctx);
  } catch (err) {
    // Synchronous throw — render instantly, no spinner engaged.
    const outcome = toFailure(err);
    reporter.instant(formatOutcome(task.label, outcome));
    return outcome;
  }

  if (!isPromise(started)) {
    // Instant decision (skip / dry-run): no animation.
    reporter.instant(formatOutcome(task.label, started));
    return started;
  }

  const stop = reporter.active(task.activeLabel ?? task.label);
  let outcome;
  try {
    outcome = await started;
  } catch (err) {
    outcome = toFailure(err);
  }
  stop(formatOutcome(task.label, outcome));
  return outcome;
}

/**
 * @param {unknown} err
 * @returns {import('./status').FailedStatus}
 */
function toFailure(err) {
  const detail = err instanceof Error ? err.message : String(err);
  return { kind: 'failed', detail };
}

/**
 * @param {unknown} v
 * @returns {v is Promise<unknown>}
 */
function isPromise(v) {
  return Boolean(v) && typeof (/** @type {any} */ (v).then) === 'function';
}

module.exports = {
  runTasks,
};
