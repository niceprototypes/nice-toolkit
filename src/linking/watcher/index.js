/**
 * @fileoverview File system watcher for linked package dist folders
 *
 * Watches the dist/ folders of all linked packages and triggers a reload
 * in the consuming project when changes are detected. This enables hot-reload
 * functionality for webpack/CRA projects that don't have native symlink watching.
 *
 * Strategy:
 * 1. Discover all file: linked packages
 * 2. Watch their dist/ folders for changes
 * 3. When changes detected, touch a trigger file in the consuming project
 * 4. Webpack/CRA detects the trigger file change and recompiles
 *
 * @module watcher
 */

const fs = require('fs');
const path = require('path');
const { findAllLinkedPackages } = require('../discovery');
const { getPackageName } = require('../../shared/fs-utils');
const { log, info, success, warn, cyan, gray } = require('../../shared/logger');
const { TRIGGER_FILE_NAME, DEBOUNCE_DELAY } = require('./constants');
const { createKeyedDebouncer } = require('./debouncer');
const {
  getTriggerFilePath,
  touchTriggerFile,
  ensureTriggerFile,
  cleanupTriggerFile,
} = require('./trigger-file');
const { watchPackage } = require('./watch-package');

// ──────────────────────────────────────────────────────────────────────────────
// Main Watch Function
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Watch options
 * @typedef {object} WatchOptions
 * @property {string} [watchDir='dist'] - Subdirectory to watch in each package
 * @property {number} [debounce=300] - Debounce delay in milliseconds
 * @property {boolean} [verbose=false] - Log detailed change information
 */

/**
 * Starts watching all linked packages and triggers recompilation on changes
 *
 * @param {string} projectDir - Project root directory
 * @param {WatchOptions} [options={}] - Watch configuration
 * @returns {{ stop: () => void }} Controller to stop watching
 *
 * @example
 * const controller = startWatching('/path/to/my-app', { verbose: true });
 * // Later...
 * controller.stop();
 */
function startWatching(projectDir, options = {}) {
  const { watchDir = 'dist', debounce = DEBOUNCE_DELAY, verbose = false } = options;

  // Find all linked packages
  const allLinkedPackages = findAllLinkedPackages(projectDir);

  if (allLinkedPackages.size === 0) {
    warn('No linked packages found. Nothing to watch.');
    return { stop: () => {} };
  }

  // Filter to only packages with the watch directory
  const linkedPackages = Array.from(allLinkedPackages).filter((pkgPath) => {
    const distPath = path.join(pkgPath, watchDir);
    if (!fs.existsSync(distPath)) {
      const pkgName = getPackageName(pkgPath);
      info(`Skipping ${pkgName} (no ${watchDir}/ folder)`);
      return false;
    }
    return true;
  });

  if (linkedPackages.length === 0) {
    warn(`No packages have ${watchDir}/ folders. Nothing to watch.`);
    return { stop: () => {} };
  }

  // Ensure trigger file exists
  if (!ensureTriggerFile(projectDir)) {
    warn('Could not set up trigger file. Watch mode may not work correctly.');
  }

  // Log what we're watching
  log(`Watching ${cyan(linkedPackages.length)} linked packages:\n`);
  for (const pkgPath of linkedPackages) {
    const pkgName = getPackageName(pkgPath);
    console.log(`  ${gray('•')} ${pkgName}`);
  }
  console.log('');

  // Create debouncer
  const debouncer = createKeyedDebouncer(debounce);

  // Start watchers
  const watchers = [];

  for (const pkgPath of linkedPackages) {
    const watcher = watchPackage(pkgPath, watchDir, (pkgName) => {
      debouncer.call(pkgName, (fileCount) => {
        const files = fileCount === 1 ? 'file' : 'files';

        if (verbose) {
          info(`${pkgName} changed (${fileCount} ${files})`);
        }

        touchTriggerFile(projectDir, pkgName);
        success(`Triggered reload for ${cyan(pkgName)}`);
      });
    });

    if (watcher) {
      watchers.push(watcher);
    }
  }

  if (watchers.length === 0) {
    warn('No packages could be watched. Ensure they have dist/ folders.');
    return { stop: () => {} };
  }

  success(`Watching ${watchers.length} packages. Press Ctrl+C to stop.\n`);

  // Return controller
  return {
    stop() {
      for (const watcher of watchers) {
        watcher.close();
      }
      info('Stopped watching linked packages');
    },
  };
}

module.exports = {
  // Constants
  TRIGGER_FILE_NAME,
  DEBOUNCE_DELAY,

  // Functions
  startWatching,
  cleanupTriggerFile,
  ensureTriggerFile,
  getTriggerFilePath,
};
