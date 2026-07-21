/**
 * @fileoverview Conflict removal from linked package node_modules
 *
 * Provides functions for removing duplicate/conflicting packages from
 * linked package node_modules directories. This prevents runtime errors
 * like "Invalid hook call" (multiple React instances) and styled-components
 * context mismatches.
 *
 * @module cleaner
 */

const path = require('path');
const { pathExists, removePath } = require('../shared/fs-utils');
const { log, info, success, fail, gray } = require('../shared/logger');
const { runTasks } = require('../shared/tasks');

// ──────────────────────────────────────────────────────────────────────────────
// Single Package Cleaning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Removes conflicting packages from a directory's node_modules
 *
 * This function removes packages from the LINKED package's node_modules
 * to prevent duplicate instances of React, styled-components, etc. that
 * cause runtime errors.
 *
 * Why this works:
 * When a linked package has its own copy of React in node_modules,
 * the bundler (webpack, vite) may resolve to that copy instead of the
 * host app's copy. By removing the linked copy, all imports resolve
 * to the host app's single instance.
 *
 * @param {string} dir - Directory containing node_modules to clean
 * @param {string[]} packages - Array of package names to remove
 * @param {object} [options] - Options object
 * @param {boolean} [options.dryRun=false] - If true, only logs what would be removed
 * @param {boolean} [options.quiet=false] - Suppress this helper's own per-package
 *   log lines (used when a caller — e.g. the dedupe task — owns the reporting).
 * @returns {{ removed: string[], skipped: string[] }} Results of the clean operation
 *
 * @example
 * // Clean react and styled-components from a linked package
 * removeConflictsInDir('/path/to/nice-react-button', [
 *   'react',
 *   'react-dom',
 *   'styled-components'
 * ]);
 *
 * @example
 * // Preview what would be removed
 * const result = removeConflictsInDir('/path/to/my-lib', ['react'], {
 *   dryRun: true
 * });
 * console.log(`Would remove ${result.removed.length} packages`);
 */
function removeConflictsInDir(dir, packages, { dryRun = false, quiet = false } = {}) {
  const nodeModulesPath = path.join(dir, 'node_modules');
  const removed = [];
  const skipped = [];

  // Check if node_modules exists
  if (!pathExists(nodeModulesPath)) {
    if (!quiet) info(`No node_modules in ${path.basename(dir)}, skipping`);
    return { removed, skipped };
  }

  // Nothing to remove
  if (!packages.length) {
    return { removed, skipped };
  }

  if (!quiet) log(`Cleaning conflicts in ${gray(dir)}`);

  for (const pkg of packages) {
    const pkgPath = path.join(nodeModulesPath, pkg);

    if (pathExists(pkgPath)) {
      if (dryRun) {
        if (!quiet) info(`[dry-run] Would remove ${pkg}`);
        removed.push(pkg);
      } else {
        try {
          removePath(pkgPath);
          if (!quiet) success(`Removed ${gray(pkg)}`);
          removed.push(pkg);
        } catch (e) {
          if (!quiet) fail(`Failed to remove ${pkg}: ${e.message}`);
          skipped.push(pkg);
        }
      }
    } else {
      skipped.push(pkg);
    }
  }

  return { removed, skipped };
}

// ──────────────────────────────────────────────────────────────────────────────
// Bulk Cleaning
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cleans all linked packages found in the project's dependency tree
 *
 * This is the main entry point for the --dedupe feature. It:
 * 1. Discovers all file: linked packages recursively
 * 2. Optionally enforces peer dependencies in each
 * 3. Removes conflicting packages from each node_modules
 *
 * This is particularly useful for the Nice ecosystem where a project
 * might have 10+ linked packages that all need cleaning after an
 * npm install regenerates their node_modules.
 *
 * @param {string} projectDir - Root project directory
 * @param {string[]} packages - Array of package names to remove from node_modules
 * @param {object} [options] - Options object
 * @param {boolean} [options.dryRun=false] - If true, only logs what would be removed
 * @param {boolean} [options.skipPeerCheck=false] - If true, skips peer dependency enforcement
 * @param {string[]} [options.peerEnforce] - Packages to enforce as peers
 * @returns {{ totalCleaned: number, totalRemoved: number }} Summary of operations
 *
 * @example
 * // Dedupe singletons across all linked packages in a Nice project
 * dedupeLinkedPackages('/path/to/nice-website-2025', [
 *   'react',
 *   'react-dom',
 *   'styled-components'
 * ]);
 *
 * @example
 * // Preview without making changes
 * const result = dedupeLinkedPackages(process.cwd(), ['react'], {
 *   dryRun: true
 * });
 * console.log(`Would dedupe ${result.totalCleaned} packages`);
 */
async function dedupeLinkedPackages(projectDir, packages, options = {}) {
  const {
    dryRun = false,
    skipPeerCheck = false,
    peerEnforce = [],
  } = options;

  // Import here to avoid circular dependency
  const { findAllLinkedPackages } = require('./discovery');
  const { ensurePeerDeps } = require('./peer-deps');
  const { cyan } = require('../shared/logger');

  log(`Scanning for all linked packages in ${gray(projectDir)}...`);

  const linkedPackages = findAllLinkedPackages(projectDir);

  if (linkedPackages.size === 0) {
    info('No file: linked packages found in project');
    return { totalCleaned: 0, totalRemoved: 0 };
  }

  // Display found packages
  log(`Found ${cyan(linkedPackages.size)} linked package(s):`);
  for (const pkg of linkedPackages) {
    info(`  ${gray(path.relative(projectDir, pkg))}`);
  }
  console.log('');

  // Each linked package is a task: enforce peers + strip conflicting singletons,
  // reporting `removed N` (or `no conflicts`) as the gray detail. The helpers run
  // `quiet` so the shared runner owns the one line per package + the tally.
  let totalRemoved = 0;
  const tasks = Array.from(linkedPackages).map((pkgPath) => ({
    label: path.basename(pkgPath),
    /** @returns {import('../shared/tasks/status').Outcome} */
    run() {
      if (!skipPeerCheck && peerEnforce.length > 0) {
        ensurePeerDeps(pkgPath, peerEnforce, { dryRun, quiet: true });
      }
      const { removed } = removeConflictsInDir(pkgPath, packages, { dryRun, quiet: true });
      totalRemoved += removed.length;
      const verb = dryRun ? 'would remove' : 'removed';
      return { kind: 'done', detail: removed.length ? `${verb} ${removed.length}` : 'no conflicts' };
    },
  }));

  await runTasks(tasks, { verb: dryRun ? 'would clean' : 'cleaned' });

  return {
    totalCleaned: linkedPackages.size,
    totalRemoved,
  };
}

module.exports = {
  removeConflictsInDir,
  dedupeLinkedPackages,
};
