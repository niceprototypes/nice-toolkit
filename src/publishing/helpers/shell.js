/**
 * @fileoverview Shell-command execution used across the publish pipeline.
 *
 * @module publisher/helpers/shell
 */

const { execSync } = require('child_process');

/**
 * Runs a shell command and returns trimmed stdout.
 *
 * Named `runShell` to disambiguate from `pm.run(pm, argv)` in
 * `../../pm.js`, which takes a parsed argv array and a package-manager
 * binary rather than a single shell-string command.
 *
 * @param {string} cmd - Shell command to execute
 * @param {object} [options] - execSync options
 * @returns {string} Trimmed stdout
 */
function runShell(cmd, options = {}) {
  return execSync(cmd, { encoding: 'utf8', ...options }).trim();
}

/**
 * Runs a shell command capturing BOTH stdout and stderr, so nothing streams to
 * the terminal (npm publish writes all its `npm notice` output to stderr, which
 * the default `runShell` would otherwise inherit and dump). On success the
 * captured output is discarded — the caller reports the outcome as a task line.
 * On a non-zero exit, execSync throws with `.stdout` / `.stderr` populated, so
 * the caller can surface the real error beneath the failed task's line.
 *
 * @param {string} cmd - Shell command to execute
 * @param {object} [options] - execSync options
 * @returns {string} Captured stdout (trimmed)
 */
function runShellCapture(cmd, options = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

module.exports = { runShell, runShellCapture };
