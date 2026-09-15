/**
 * @fileoverview The presentation layer for task orchestration — the one place
 * that owns the spinner, the glyph lines, the failure output, and the summary
 * tally. Scripts never print their own status lines; they hand the runner typed
 * tasks and the reporter renders them uniformly.
 *
 * This reporter serves the terminal, sequential scripts (build/reset, unlink,
 * dedupe, clean, peer-deps). It reuses `heart-spinner` for the single in-flight
 * task, which already degrades cleanly from an animated TTY line to a static
 * line on pipes/CI — so there is one code path, not a TTY/non-TTY fork.
 *
 * `pause()`/`resume()` exist so a task that needs to read stdin (the publish OTP
 * prompt) can borrow the terminal and hand it back. The concurrent live-tree
 * reporter that develop needs is a separate, later backend behind this same
 * surface; nothing here assumes only one design.
 *
 * @module shared/tasks/reporter
 */

const { startHeartSpinner } = require('../heart-spinner');
const { success, fail } = require('../logger');
const { formatOutcome } = require('./status');

// ──────────────────────────────────────────────────────────────────────────────
// Reporter
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Reporter
 * @property {(activeLabel: string) => (label: string, outcome: import('./status').Outcome) => void} active
 *   Begin the spinner for an in-flight (async) task; returns an `end(label,
 *   outcome)` that clears the animation and settles the task (line reporter
 *   prints it; table reporter records a row).
 * @property {(label: string, outcome: import('./status').Outcome) => void} instant
 *   Settle a task that resolved synchronously (no spinner).
 * @property {(text: string) => void} raw
 *   Emit captured child output verbatim (shown beneath a failure line).
 * @property {(report: { done: string[], skipped: string[], failed: string[] }, verb: string) => void} summary
 *   Print the `verb N, skipped N, failed N` tally (green if clean, red if any failed).
 * @property {(report?: object) => void} [finalize]
 *   Flush any batched output once every task has settled (table reporter renders here).
 * @property {() => void} pause  Suspend rendering so a task can own stdin.
 * @property {() => void} resume Resume rendering after `pause()`.
 */

/**
 * Creates the default terminal reporter.
 *
 * @param {object} [opts]
 * @param {NodeJS.WriteStream} [opts.stream=process.stdout] - Sink for instant/raw lines.
 * @returns {Reporter}
 */
function createReporter({ stream = process.stdout } = {}) {
  // The in-flight async task's spinner handle + its label, tracked so
  // pause()/resume() can suspend and restore it around a task that must read
  // stdin (the publish OTP re-prompt). Null whenever no async task is mid-flight.
  let liveStop = null;
  let liveLabel = null;

  return {
    active(activeLabel) {
      // heart-spinner owns the two-space indent and the animation lifecycle.
      liveLabel = activeLabel;
      liveStop = startHeartSpinner(activeLabel);
      return (label, outcome) => {
        const settled = formatOutcome(label, outcome);
        // Normal path: the spinner is live, so clear it and print the settled
        // line in one step. If a pause() left it suspended without a resume(),
        // print the line directly instead.
        if (liveStop) liveStop(settled);
        else stream.write(`  ${settled}\n`);
        liveStop = null;
        liveLabel = null;
      };
    },

    instant(label, outcome) {
      stream.write(`  ${formatOutcome(label, outcome)}\n`);
    },

    raw(text) {
      if (text) stream.write(`${text}\n`);
    },

    summary(report, verb) {
      const line = `${verb} ${report.done.length}, skipped ${report.skipped.length}, failed ${report.failed.length}`;
      if (report.failed.length > 0) fail(line);
      else success(line);
    },

    // Line reporter renders each task as it settles, so there is nothing to
    // flush at the end — the table reporter overrides this.
    finalize() {},

    // Suspend the in-flight spinner so a task can borrow the terminal for stdin
    // (e.g. re-prompting for an OTP mid-publish). Clears the animated line; the
    // task's persistent line is still printed later by the `end` from active().
    pause() {
      if (liveStop) {
        liveStop(); // stop with no final line → clears the animation, restores cursor
        liveStop = null;
      }
    },

    // Restart the spinner for the still-in-flight task after the stdin work.
    resume() {
      if (liveLabel && !liveStop) liveStop = startHeartSpinner(liveLabel);
    },
  };
}

module.exports = {
  createReporter,
};
