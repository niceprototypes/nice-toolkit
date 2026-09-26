/**
 * @fileoverview Shared helpers for the publish workflow.
 *
 * Sub-modules:
 * - prompt.js     — prompt, promptKey
 * - shell.js      — runShell
 * - package.js    — pkgDir, getNpmVersion, getLocalVersion
 * - git-status.js — getChangeStatus
 *
 * @module publisher/helpers
 */

const { prompt, promptKey } = require('./prompt');
const { runShell } = require('./shell');
const { pkgDir, getNpmVersion, getLocalVersion } = require('./package');
const { getChangeStatus } = require('./git-status');

module.exports = {
  prompt,
  promptKey,
  runShell,
  pkgDir,
  getNpmVersion,
  getLocalVersion,
  getChangeStatus,
};
