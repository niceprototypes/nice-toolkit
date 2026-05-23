const { calcVersion } = require("../versioning")

/**
 * Resolves the version string a candidate will publish at, given a bump
 * choice. `as-is` is a no-op (used for first publishes of new packages).
 *
 * @param {object} c
 * @param {"major"|"minor"|"patch"|"as-is"} bumpType
 * @returns {string} resolved version
 */
function derivedVersion(c, bumpType) {
  if (bumpType === "as-is") return c.localVersion
  return calcVersion(c.localVersion, bumpType)
}

module.exports = { derivedVersion }
