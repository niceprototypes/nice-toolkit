/**
 * @fileoverview Bump-intent storage — re-exports the per-concern modules.
 *
 * Each Nice ecosystem package records pending semver intent in a plain-text
 * file at `.nice/bump.md` under the package root. One line per entry, in the
 * form `[ts] {level}: {commit-message}`. `nicely --publish` reads every entry,
 * derives the publish commit's subject/body from them, and clears the file
 * on success.
 *
 * Plain text was chosen over JSON so merges between branches conflict at the
 * line level rather than on JSON structure, and so `cat`/`grep` trivially
 * surface the pending state.
 *
 * Sub-modules:
 * - constants.js — file layout, regex, level whitelist, path helpers
 * - parse.js     — readBumpIntent, parseEntryLine
 * - level.js     — computeBumpLevel
 * - compose.js   — composeCommitMessage
 * - write.js     — appendBumpIntent, clearBumpIntent, formatTimestamp
 *
 * @module bump
 */

const {
  VALID_LEVELS,
  bumpFilePath,
  bumpFileRelativePath,
} = require('./constants');
const { readBumpIntent } = require('./parse');
const { computeBumpLevel } = require('./level');
const { composeCommitMessage } = require('./compose');
const {
  formatTimestamp,
  appendBumpIntent,
  clearBumpIntent,
} = require('./write');

module.exports = {
  readBumpIntent,
  appendBumpIntent,
  clearBumpIntent,
  computeBumpLevel,
  composeCommitMessage,
  bumpFilePath,
  bumpFileRelativePath,
  formatTimestamp,
  VALID_LEVELS,
};
