/**
 * @fileoverview Reverse dependency graph resolution
 *
 * Given explicitly changed packages, resolves all packages that must
 * also be updated by walking the reverse dependency graph (BFS).
 *
 * @module publisher/graph
 */

const path = require('path');
const fs = require('fs');
const { readJSON } = require('../shared/fs-utils');
const { ALL_PACKAGES } = require('./constants');
const { pkgDir } = require('./helpers');

/**
 * Registered packages a parsed package.json depends on locally:
 * - `dependencies` / `devDependencies` entries that are `file:` refs, and
 * - `peerDependencies` entries naming a registered package (any range). A
 *   nice-* dep declared as peer + `file:` devDependency is covered by the
 *   devDependency; the peer edge also covers a peer declared without one.
 *
 * @param {object} pkg - Parsed package.json
 * @param {string[]} allPackages - Registered package names
 * @returns {Set<string>}
 */
function collectLocalDeps(pkg, allPackages) {
  const deps = new Set();
  const fileDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [depName, depVersion] of Object.entries(fileDeps)) {
    if (typeof depVersion !== 'string' || !depVersion.startsWith('file:')) continue;
    if (!allPackages.includes(depName)) continue;
    deps.add(depName);
  }

  for (const depName of Object.keys(pkg.peerDependencies || {})) {
    if (allPackages.includes(depName)) deps.add(depName);
  }

  return deps;
}

/**
 * Builds a reverse dependency map from all publishable packages.
 * Key = package name, Value = Set of packages that depend on it.
 *
 * Reads each package's package.json and collects its edges via
 * collectLocalDeps (file: deps/devDeps + registered peerDependencies).
 *
 * @returns {Map<string, Set<string>>}
 */
function buildReverseDependencyMap() {
  const reverseMap = new Map();

  for (const name of ALL_PACKAGES) {
    const dir = pkgDir(name);
    try {
      fs.statSync(dir);
    } catch {
      continue;
    }

    try {
      const pkg = readJSON(path.join(dir, 'package.json'), { useCache: false });
      for (const depName of collectLocalDeps(pkg, ALL_PACKAGES)) {
        if (!reverseMap.has(depName)) reverseMap.set(depName, new Set());
        reverseMap.get(depName).add(name);
      }
    } catch {
      // Package has no readable package.json
    }
  }

  return reverseMap;
}

/**
 * Given explicitly changed packages, resolves all packages that must also
 * be updated by walking the reverse dependency graph (BFS).
 *
 * @param {string[]} changedPackages - Packages with actual source changes
 * @returns {{ changed: Set<string>, dependents: Set<string> }}
 */
function resolveAffected(changedPackages) {
  const reverseMap = buildReverseDependencyMap();
  const changed = new Set(changedPackages);
  const all = new Set(changedPackages);
  const queue = [...changedPackages];

  while (queue.length > 0) {
    const current = queue.shift();
    const dependents = reverseMap.get(current) || new Set();

    for (const dep of dependents) {
      if (!all.has(dep)) {
        all.add(dep);
        queue.push(dep);
      }
    }
  }

  const dependents = new Set([...all].filter(p => !changed.has(p)));
  return { changed, dependents };
}

module.exports = {
  collectLocalDeps,
  buildReverseDependencyMap,
  resolveAffected,
};