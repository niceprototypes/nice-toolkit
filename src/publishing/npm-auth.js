/**
 * @fileoverview npm authentication verification
 * @module npm-auth
 */

const { execSync, spawnSync } = require('child_process');
const { info, warn, fail, cyan } = require('../shared/logger');
const { promptKey } = require('./helpers');

/**
 * Returns the current npm username, or null if not authenticated.
 *
 * @returns {string|null}
 */
function whoami() {
  try {
    return execSync('npm whoami 2>/dev/null', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Verifies the user is authenticated with npm. If not, offers to launch
 * `npm login` inline so the user can authenticate without dropping out of
 * the publish session. Esc aborts.
 *
 * The `npm login` child runs with inherited stdio so its interactive
 * prompts (username, password, OTP) read/write directly to the same TTY.
 * After it exits we re-check whoami and either continue or re-prompt.
 *
 * @returns {Promise<boolean>} True once authenticated, false if user aborts
 */
async function verifyNpmAuth() {
  while (true) {
    const npmUser = whoami();
    if (npmUser) {
      info(`npm authenticated as ${cyan(npmUser)}`);
      return true;
    }

    warn('Not logged in to npm.');
    const key = await promptKey('Press Enter to log in, Esc to abort: ', ['\x1b']);
    if (key === '\x1b') {
      info('Aborted.');
      return false;
    }

    // Inherit stdio so npm's interactive prompts (username, password, OTP)
    // talk directly to the user's TTY. spawnSync blocks the publish flow
    // until login completes (or the user Ctrl+C's out of npm).
    const result = spawnSync('npm', ['login'], { stdio: 'inherit' });
    if (result.status !== 0) {
      fail('npm login did not complete. Retrying check…');
    }
    // Loop and re-check whoami regardless — covers both success and the
    // edge case where the user reached login completion via some other
    // path during the same session.
  }
}

module.exports = {
  verifyNpmAuth,
};