/**
 * @fileoverview The standardized task-status vocabulary — the single source of
 * truth for the iconography every orchestrating script shares.
 *
 * A task's `run()` returns one of these terminal outcomes. Crucially, the
 * framework never assumes a task "succeeded" because a child process exited 0 —
 * the task decides its own outcome by whatever means (exit code, fs result,
 * aggregate count) and reports it as a `Status`. That is what lets the same core
 * serve builds (exit code), dedupe (fs removal), and peer-deps (conditional
 * install) without special-casing any of them.
 *
 * Reserved for the concurrent/lifecycle scripts (develop, watcher — not built
 * yet): an `active` state (rendered automatically by the reporter's spinner) and
 * a `reload` state (`⟳`). They are intentionally absent here until those scripts
 * are designed; terminal scripts only ever return `done | skipped | failed`.
 *
 * @module shared/tasks/status
 */

const { gray, red, yellow } = require('../logger');

// ──────────────────────────────────────────────────────────────────────────────
// The Status union
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A task completed its work. `detail` renders as a gray suffix (e.g. a dry-run
 * "would build", a dedupe "cleaned 3"); omitting it yields the bare `✓ label`.
 * @typedef {{ kind: 'done', detail?: string }} DoneStatus
 */

/**
 * A task was intentionally not run (no build script, nothing to do). `detail`
 * is the required gray reason, mirroring reset's `⊘ name  no build script`.
 * @typedef {{ kind: 'skipped', detail: string }} SkippedStatus
 */

/**
 * A task completed, but with non-fatal warnings (e.g. a package reloaded while
 * its type-checker emitted diagnostics). `detail` is the gray suffix; `count`
 * (optional) is the warning tally the concurrent develop reporter renders as
 * `⚠ label  (N warnings)`. Terminal like `done` — the work still finished.
 * @typedef {{ kind: 'warned', detail?: string, count?: number }} WarnedStatus
 */

/**
 * A task failed. `detail` is the gray one-line reason; `output` (optional) is
 * captured child output the reporter prints beneath the failure line.
 * @typedef {{ kind: 'failed', detail: string, output?: string }} FailedStatus
 */

/**
 * The terminal outcome a task's `run()` resolves to. `warned` is used by the
 * concurrent develop reporter; the sequential terminal scripts only ever return
 * `done | skipped | failed`.
 * @typedef {DoneStatus | SkippedStatus | WarnedStatus | FailedStatus} Outcome
 */

// ──────────────────────────────────────────────────────────────────────────────
// Presentation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Renders an outcome as its persistent one-line form, WITHOUT the leading
 * indent (the reporter owns the two-space indent, via the heart spinner for
 * async tasks or a direct write for instant ones).
 *
 * Format parity with the existing hand-rolled lines:
 *   done (no detail):   `✓ label`
 *   done (with detail): `⊘-style gray ✓ label  gray(detail)`  (e.g. dry-run)
 *   skipped:            `gray(⊘) label  gray(detail)`
 *   failed:             `red(✗) label  gray(detail)`
 *
 * @param {string} label - The task's display name.
 * @param {Outcome} outcome - The terminal status.
 * @returns {string} The formatted line (no indent, no trailing newline).
 */
function formatOutcome(label, outcome) {
  switch (outcome.kind) {
    case 'done':
      return outcome.detail
        ? `${gray('✓')} ${label}  ${gray(outcome.detail)}`
        : `✓ ${label}`;
    case 'skipped':
      return `${gray('⊘')} ${label}  ${gray(outcome.detail)}`;
    case 'warned': {
      const suffix = outcome.count
        ? gray(`(${outcome.count} warning${outcome.count === 1 ? '' : 's'})`)
        : outcome.detail
          ? gray(outcome.detail)
          : '';
      return suffix ? `${yellow('⚠')} ${label}  ${suffix}` : `${yellow('⚠')} ${label}`;
    }
    case 'failed':
      return `${red('✗')} ${label}  ${gray(outcome.detail)}`;
    default: {
      // Exhaustiveness guard — a new kind must extend formatOutcome.
      const _never = /** @type {never} */ (outcome);
      return String(_never);
    }
  }
}

/**
 * The status glyph alone, colored by kind — for callers (e.g. the table
 * reporter's `toRow`) that compose their own cells and just need the shared
 * icon. Single-sources the vocabulary with {@link formatOutcome}.
 *
 * @param {Outcome} outcome
 * @returns {string} The colored glyph (`✓` / `⊘` / `⚠` / `✗`).
 */
function glyphFor(outcome) {
  switch (outcome.kind) {
    case 'done': return '✓';
    case 'skipped': return gray('⊘');
    case 'warned': return yellow('⚠');
    case 'failed': return red('✗');
    default: {
      const _never = /** @type {never} */ (outcome);
      return String(_never);
    }
  }
}

module.exports = {
  formatOutcome,
  glyphFor,
};
