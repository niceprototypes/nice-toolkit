/**
 * @fileoverview Dependency swapping for publish (file: ↔ semver)
 * @module publisher/deps
 */

const path = require('path');
const { readJSON, writeJSON, clearCache } = require('../shared/fs-utils');
const { pkgDir, getLocalVersion } = require('./helpers');

/**
 * Rewrites a parsed package.json in place for publishing and returns the
 * values it replaced, keyed `${depType}.${depName}`.
 *
 * - `dependencies` / `devDependencies` `file:` refs → `^<target local version>`.
 * - `peerDependencies` naming a nice-* package that is in this publish run →
 *   `^<that package's newVersion>`. A dependency released at a new major in the
 *   same run would otherwise be advertised at the stale source range. nice-*
 *   peers outside the run, and non-nice peers (react, …), are left as written.
 *
 * Pure apart from `getVersion`, so it is testable without touching disk.
 *
 * @param {object} pkg - Parsed package.json (mutated)
 * @param {(name: string) => string} getVersion - Local version lookup for file: targets
 * @param {Map<string, string>} [runVersions] - Package name → newVersion for every package in this run
 * @returns {Object<string, string>} Original values of every rewritten entry
 */
function rewriteDepsForPublish(pkg, getVersion, runVersions = new Map()) {
  const originals = {};

  for (const depType of ['dependencies', 'devDependencies']) {
    const deps = pkg[depType];
    if (!deps) continue;

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (typeof depVersion === 'string' && depVersion.startsWith('file:')) {
        originals[`${depType}.${depName}`] = depVersion;
        // Read the target package's current version
        const targetVersion = getVersion(depName);
        deps[depName] = `^${targetVersion}`;
      }
    }
  }

  const peers = pkg.peerDependencies;
  if (peers) {
    for (const [depName, range] of Object.entries(peers)) {
      if (!depName.startsWith('nice-') || !runVersions.has(depName)) continue;
      const next = `^${runVersions.get(depName)}`;
      if (range === next) continue;
      originals[`peerDependencies.${depName}`] = range;
      peers[depName] = next;
    }
  }

  return originals;
}

/**
 * Puts the values recorded by `rewriteDepsForPublish` back into a parsed
 * package.json (mutated in place).
 *
 * @param {object} pkg - Parsed package.json (mutated)
 * @param {Object<string, string>} originals - Values returned by rewriteDepsForPublish
 * @returns {object} The same pkg
 */
function restoreDeps(pkg, originals) {
  for (const [key, value] of Object.entries(originals)) {
    const [depType, depName] = key.split('.');
    if (pkg[depType] && pkg[depType][depName]) {
      pkg[depType][depName] = value;
    }
  }
  return pkg;
}

/**
 * Swaps file: deps to semver ranges for publishing, and rewrites in-run
 * nice-* peer ranges to the versions being published (see rewriteDepsForPublish).
 * Returns the original values so they can be restored.
 *
 * @param {string} name - Package name
 * @param {Map<string, string>} [runVersions] - Package name → newVersion for every package in this run
 * @returns {Object<string, string>} Original values (file: refs and source peer ranges)
 */
function swapFileDepsToSemver(name, runVersions = new Map()) {
  const pkgPath = path.join(pkgDir(name), 'package.json');
  const pkg = readJSON(pkgPath, { useCache: false });
  const originals = rewriteDepsForPublish(pkg, getLocalVersion, runVersions);

  if (Object.keys(originals).length > 0) {
    writeJSON(pkgPath, pkg);
    clearCache();
  }

  return originals;
}

/**
 * Restores file: deps and source peer ranges after publishing
 *
 * @param {string} name - Package name
 * @param {Object<string, string>} originals - Original values from swapFileDepsToSemver
 */
function restoreFileDeps(name, originals) {
  if (Object.keys(originals).length === 0) return;

  const pkgPath = path.join(pkgDir(name), 'package.json');
  const pkg = readJSON(pkgPath, { useCache: false });

  restoreDeps(pkg, originals);

  writeJSON(pkgPath, pkg);
  clearCache();
}

module.exports = {
  swapFileDepsToSemver,
  restoreFileDeps,
  rewriteDepsForPublish,
  restoreDeps,
};
