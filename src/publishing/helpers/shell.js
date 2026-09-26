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

module.exports = { runShell };
