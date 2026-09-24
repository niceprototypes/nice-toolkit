/**
 * @fileoverview Peer dependency enforcement for linked packages
 *
 * Ensures that linked packages correctly declare React, styled-components,
 * and other shared dependencies as peerDependencies rather than dependencies.
 * This is crucial for preventing duplicate instances in the Nice ecosystem.
 *
 * @module peer-deps
 */

const path = require('path');
const { readJSON, writeJSON } = require('../shared/fs-utils');
const { log, info, success, cyan } = require('../shared/logger');

// ──────────────────────────────────────────────────────────────────────────────
// Peer Dependency Enforcement
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Converts a version string to a caret range
 *
 * If the version already uses caret notation, returns as-is.
 * Otherwise, extracts the numeric version and adds a caret.
 *
 * @param {string} version - Version string (e.g., "18.2.0", "^18.0.0")
 * @returns {string} Caret-prefixed version
 * @private
 *
 * @example
 * toCaretRange("18.2.0")   // => "^18.2.0"
 * toCaretRange("^18.0.0")  // => "^18.0.0"
 * toCaretRange(">=18.0.0") // => "^18.0.0"
 */
function toCaretRange(version) {
  if (typeof version !== 'string') return '*';
  if (version.startsWith('^')) return version;

  // Extract numeric version, removing any prefix (>=, ~, etc.)
  const numericVersion = version.replace(/^[^\d]*/, '');
  return numericVersion ? `^${numericVersion}` : version;
}

/**
 * Ensures specified packages are listed as peerDependencies in a package
 *
 * Performs the following:
 * 1. Moves packages from dependencies to peerDependencies
 * 2. Converts version ranges to caret notation for flexibility
 *
 * It never adds a `prepare` script: nice-* packages must not carry one (npm
 * runs it on every `file:` install, cascading rebuilds across consumers).
 * Rebuilds are explicit — see `dist-builder.js` (`nicely build all`).
 *
 * This is essential for the Nice ecosystem because all packages
 * (nice-react-button, nice-react-ink, etc.) must share the same
 * React and styled-components instances with the consuming application.
 *
 * @param {string} packageDir - Path to the package directory
 * @param {string[]} packageNames - Package names to move to peerDependencies
 * @param {object} [options] - Options object
 * @param {boolean} [options.dryRun=false] - If true, only logs changes without modifying files
 * @param {boolean} [options.quiet=false] - Suppress this helper's own log lines
 *   (used when a caller — e.g. the dedupe task — owns the reporting).
 * @returns {boolean} True if any changes were made (or would be made in dry-run)
 *
 * @example
 * // Ensure React is a peer dependency
 * ensurePeerDeps('/path/to/nice-react-button', ['react', 'react-dom']);
 *
 * @example
 * // Preview changes without modifying
 * ensurePeerDeps('/path/to/my-lib', ['react'], { dryRun: true });
 */
function ensurePeerDeps(packageDir, packageNames, { dryRun = false, quiet = false } = {}) {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkg = readJSON(pkgJsonPath, { useCache: false }); // Fresh read for modifications

  let hasChanges = false;

  // Initialize sections if missing
  pkg.peerDependencies = pkg.peerDependencies || {};
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.dependencies = pkg.dependencies || {};

  // Move specified packages to peerDependencies
  for (const name of packageNames) {
    if (pkg.dependencies[name]) {
      const currentVersion = pkg.dependencies[name];
      const peerVersion = toCaretRange(currentVersion);

      // Only add to peerDeps if not already there
      if (!pkg.peerDependencies[name]) {
        pkg.peerDependencies[name] = peerVersion;
      }

      delete pkg.dependencies[name];
      hasChanges = true;

      if (!quiet) log(`Moved ${cyan(name)} -> peerDependencies (${peerVersion})`);
    }
  }

  // Write changes
  if (hasChanges) {
    if (dryRun) {
      if (!quiet) info(`[dry-run] Would update package.json in ${packageDir}`);
    } else {
      writeJSON(pkgJsonPath, pkg);
      if (!quiet) success('Updated package.json (peerDependencies)');
    }
  }

  return hasChanges;
}

/**
 * Checks if a package has correct peer dependency configuration
 *
 * Validates that specified packages are in peerDependencies and not
 * in regular dependencies.
 *
 * @param {string} packageDir - Path to the package directory
 * @param {string[]} expectedPeers - Package names expected to be peers
 * @returns {{ valid: boolean, issues: string[] }} Validation result
 *
 * @example
 * const result = validatePeerDeps('/path/to/my-lib', ['react', 'react-dom']);
 * if (!result.valid) {
 *   console.log('Issues:', result.issues);
 * }
 */
function validatePeerDeps(packageDir, expectedPeers) {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkg = readJSON(pkgJsonPath);

  const issues = [];

  for (const name of expectedPeers) {
    // Check if it's incorrectly in dependencies
    if (pkg.dependencies && pkg.dependencies[name]) {
      issues.push(`${name} should be a peerDependency, not a dependency`);
    }

    // Check if it's missing from peerDependencies
    if (!pkg.peerDependencies || !pkg.peerDependencies[name]) {
      // Only report if it's not in devDependencies either (for testing)
      if (!pkg.devDependencies || !pkg.devDependencies[name]) {
        issues.push(`${name} is not listed as a peerDependency`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

module.exports = {
  toCaretRange,
  ensurePeerDeps,
  validatePeerDeps,
};
