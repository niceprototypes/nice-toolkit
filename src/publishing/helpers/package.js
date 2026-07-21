/**
 * @fileoverview Package directory + version lookups used by the
 * publisher (local + remote).
 *
 * @module publisher/helpers/package
 */

const path = require('path');
const { execFile } = require('child_process');
const { readJSON } = require('../../shared/fs-utils');
const { NICE_BASE } = require('../constants');

/**
 * Resolves the absolute filesystem path for a package.
 *
 * @param {string} name - Package name (e.g. "nice-react-button")
 * @returns {string}
 */
function pkgDir(name) {
  // Folder name drops the "nice-" prefix from the npm package name.
  return path.join(NICE_BASE, name.replace(/^nice-/, ''));
}

/**
 * Returns the published npm version of a package, or `null` when the
 * package has never been published (or `npm view` errors).
 *
 * Async (non-blocking) so the caller's scan loop yields to the event loop
 * between packages — that keeps the heartbeat spinner animating and lets
 * SIGINT (Ctrl+C) interrupt the scan instead of being swallowed per-package.
 *
 * @param {string} name - Package name
 * @returns {Promise<string|null>}
 */
function getNpmVersion(name) {
  return new Promise((resolve) => {
    execFile('npm', ['view', name, 'version'], { encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

/**
 * Returns the local version from the package's package.json.
 *
 * @param {string} name - Package name
 * @returns {string}
 */
function getLocalVersion(name) {
  const pkg = readJSON(path.join(pkgDir(name), 'package.json'), { useCache: false });
  return pkg.version;
}

module.exports = { pkgDir, getNpmVersion, getLocalVersion };
