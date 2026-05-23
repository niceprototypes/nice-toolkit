/**
 * @fileoverview Private helper to collect the `--bump` message tokens
 *
 * @module args/bump-message
 */

/**
 * Collects the message for `--bump <level> <message...>`. Everything after
 * `--bump <level>` that is not a flag becomes the message, joined by spaces.
 *
 * @param {string[]} args - Raw CLI arguments
 * @returns {string|null} The joined message, or null if none provided
 */
function findBumpMessage(args) {
  const idx = args.indexOf('--bump');
  if (idx === -1) return null;
  // Skip --bump and its level value; collect positionals until next flag
  const parts = [];
  for (let i = idx + 2; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    parts.push(args[i]);
  }
  const joined = parts.join(' ').trim();
  return joined || null;
}

module.exports = {
  findBumpMessage,
};
