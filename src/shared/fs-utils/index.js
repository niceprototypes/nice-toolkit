/**
 * @fileoverview File system utilities — re-exports the per-concern modules
 * so consumers can `require('./fs-utils')` and pull any helper.
 *
 * Concerns:
 * - cache.js   — in-memory package.json cache (clearCache)
 * - json.js    — readJSON / writeJSON
 * - paths.js   — pathExists, removePath, removeFile, ensureDir, readDir, removeEmptyDir, directorySize
 * - package.js — getPackageName
 *
 * @module fs-utils
 */

const { clearCache } = require('./cache');
const { readJSON, writeJSON } = require('./json');
const {
  pathExists,
  removePath,
  removeFile,
  ensureDir,
  readDir,
  removeEmptyDir,
  directorySize,
} = require('./paths');
const { getPackageName } = require('./package');

module.exports = {
  // Cache management
  clearCache,

  // JSON operations
  readJSON,
  writeJSON,

  // Path operations
  pathExists,
  removePath,
  removeFile,
  ensureDir,
  readDir,
  removeEmptyDir,
  directorySize,

  // Package metadata
  getPackageName,
};