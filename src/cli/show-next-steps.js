const path = require('path');
const { log, cyan, gray } = require('../shared/logger');
const { readJSON } = require('../shared/fs-utils');

/**
 * Displays recommended next steps after a successful link operation.
 * Adapts suggestions based on available scripts and project type.
 *
 * @param {string} resolvedPkgPath - Absolute path to the linked package
 * @param {boolean} isCRA - Whether the consuming project uses CRA
 * @private
 */
function showNextSteps(resolvedPkgPath, isCRA) {
  const pkg = readJSON(path.join(resolvedPkgPath, 'package.json'));
  const hasDevScript = pkg.scripts?.dev;
  const hasWatchScript = pkg.scripts?.['build:watch'];
  const pkgName = path.basename(resolvedPkgPath);

  log('\nNext steps:');

  if (hasDevScript || hasWatchScript) {
    const watchCmd = hasDevScript ? 'npm run dev' : 'npm run build:watch';
    log(`Run ${cyan(watchCmd)} in ${gray(pkgName)} for live rebuilding`);
    log(`Edit files in ${gray(pkgName)} → auto-rebuild → changes appear in your app`);
  } else {
    log(`Run ${cyan('npm run build')} in ${gray(pkgName)} after making changes`);
  }

  if (isCRA) {
    log(`Restart your dev server with: ${cyan('NODE_OPTIONS=--preserve-symlinks npm start')}`);
  } else {
    log('Restart your dev server if needed');
  }

  log(`To unlink: run ${cyan('npx nice-toolkit --unlink')}`);
}

module.exports = { showNextSteps };
