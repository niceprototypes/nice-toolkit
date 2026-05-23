const path = require('path');
const { info } = require('../shared/logger');
const { readJSON } = require('../shared/fs-utils');

/**
 * Detects Create React App by checking for react-scripts in dependencies.
 * Displays NODE_OPTIONS advice if found.
 *
 * @param {string} projectDir - Project root directory
 * @returns {boolean} True if CRA was detected
 * @private
 */
function showCRAAdvice(projectDir) {
  try {
    const pkg = readJSON(path.join(projectDir, 'package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['react-scripts']) {
      info('CRA detected. If module resolution errors occur, try:');
      info('  export NODE_OPTIONS=--preserve-symlinks  (bash/zsh)');
      info('  setx NODE_OPTIONS "--preserve-symlinks"  (Windows)');
      return true;
    }
  } catch {
    // package.json missing or unreadable — not a CRA project
  }
  return false;
}

module.exports = { showCRAAdvice };
