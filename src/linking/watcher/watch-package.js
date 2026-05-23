/**
 * @fileoverview Per-package fs.watch wrapper
 */

const fs = require('fs');
const path = require('path');
const { getPackageName } = require('../../shared/fs-utils');
const { warn } = require('../../shared/logger');

/**
 * Watches a single package's dist folder
 *
 * @param {string} pkgPath - Absolute path to package
 * @param {string} watchDir - Subdirectory to watch (e.g., 'dist')
 * @param {(pkgName: string) => void} onChange - Callback when changes detected
 * @returns {fs.FSWatcher | null} Watcher instance or null if failed
 */
function watchPackage(pkgPath, watchDir, onChange) {
  const distPath = path.join(pkgPath, watchDir);
  const pkgName = getPackageName(pkgPath);

  if (!fs.existsSync(distPath)) {
    warn(`No ${watchDir}/ folder in ${pkgName} - run 'npm run dev' in that package`);
    return null;
  }

  try {
    const watcher = fs.watch(distPath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        onChange(pkgName);
      }
    });

    watcher.on('error', (error) => {
      warn(`Watcher error for ${pkgName}: ${error.message}`);
    });

    return watcher;
  } catch (e) {
    warn(`Could not watch ${pkgName}: ${e.message}`);
    return null;
  }
}

module.exports = {
  watchPackage,
};
