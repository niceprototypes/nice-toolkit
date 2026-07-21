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

// ──────────────────────────────────────────────────────────────────────────────
// Reporter
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Reporter
 * @property {(activeLabel: string) => (finalLine: string) => void} active
 *   Begin the spinner for an in-flight (async) task; returns a `stop(finalLine)`
 *   that clears the animation and prints the persistent line.
 * @property {(line: string) => void} instant
 *   Print a resolved line with no spinner (for tasks that settle synchronously).
 * @property {(text: string) => void} raw
 *   Emit captured child output verbatim (shown beneath a failure line).
 * @property {(report: { done: string[], skipped: string[], failed: string[] }, verb: string) => void} summary
 *   Print the `verb N, skipped N, failed N` tally (green if clean, red if any failed).
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
  return {
    active(activeLabel) {
      // heart-spinner owns the two-space indent and the animation lifecycle.
      const stop = startHeartSpinner(activeLabel);
      return (finalLine) => stop(finalLine);
    },

    instant(line) {
      stream.write(`  ${line}\n`);
    },

    raw(text) {
      if (text) stream.write(`${text}\n`);
    },

    summary(report, verb) {
      const line = `${verb} ${report.done.length}, skipped ${report.skipped.length}, failed ${report.failed.length}`;
      if (report.failed.length > 0) fail(line);
      else success(line);
    },

    // No-ops until the concurrent live-region backend implements suspend/resume
    // (needed by publish's interactive OTP prompt). The surface is defined now
    // so callers can be written against it before that backend lands.
    pause() {},

    resume() {},
  };
}

module.exports = {
  createReporter,
};
