/**
 * @fileoverview Path-level filesystem helpers — exists checks, directory
 * creation, recursive removal, single-file removal, directory size.
 *
 * @module fs-utils/paths
 */

const fs = require('fs');
const path = require('path');

/**
 * Checks if a path exists on the filesystem.
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if path exists
 */
function pathExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Removes a file or directory recursively.
 *
 * Equivalent to `rm -rf`. Safe to call on non-existent paths.
 *
 * @param {string} targetPath - Path to remove
 * @returns {void}
 * @throws {Error} If removal fails (e.g., permission denied)
 *
 * @example
 * removePath('/project/node_modules/react');
 */
function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

/**
 * Removes a single file.
 *
 * Idempotent — missing files are not an error. Use removePath for directories.
 *
 * @param {string} filePath - File path to remove
 * @returns {void}
 *
 * @example
 * removeFile('/project/.symlink-trigger.js');
 */
function removeFile(filePath) {
  fs.rmSync(filePath, { force: true });
}

/**
 * Creates a directory and all parent directories if they don't exist.
 *
 * Equivalent to `mkdir -p`.
 *
 * @param {string} dirPath - Directory path to create
 * @returns {void}
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Reads the contents of a directory.
 *
 * @param {string} dirPath - Directory to read
 * @returns {string[]} Array of filenames in the directory
 * @throws {Error} If directory cannot be read
 */
function readDir(dirPath) {
  return fs.readdirSync(dirPath);
}

/**
 * Removes an empty directory.
 *
 * @param {string} dirPath - Directory to remove
 * @returns {void}
 * @throws {Error} If directory is not empty or cannot be removed
 */
function removeEmptyDir(dirPath) {
  fs.rmdirSync(dirPath);
}

/**
 * The total size of the files under a directory, recursively.
 *
 * @param {string} dirPath - Directory to measure
 * @returns {number | null} Bytes, or null when the directory does not exist
 */
function directorySize(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
  let bytes = 0;
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    try {
      bytes += entry.isDirectory() ? directorySize(full) ?? 0 : fs.statSync(full).size;
    } catch {
      /* removed while measuring (a prune or a rebuild) */
    }
  }
  return bytes;
}

module.exports = {
  directorySize,
  pathExists,
  removePath,
  removeFile,
  ensureDir,
  readDir,
  removeEmptyDir,
};