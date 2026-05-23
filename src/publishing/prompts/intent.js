const { pkgDir } = require("../helpers")
const { readBumpIntent } = require("../../shared/bump")

/**
 * Reads each candidate's `.nice/bump.md` and attaches the parsed entries +
 * computed level. Read once up front (not lazily inside the render loop) so
 * the same parsed data drives the table, the [4] View logs output, and the
 * recommendation logic without re-reading the file on every keystroke.
 *
 * @param {object[]} candidates
 * @returns {object[]} candidates with `intentLevel` and `intentEntries` added
 */
function enrichWithIntent(candidates) {
  return candidates.map((c) => {
    const { entries, level } = readBumpIntent(pkgDir(c.name))
    return { ...c, intentLevel: level, intentEntries: entries }
  })
}

/**
 * Default bump level for a candidate.
 *
 * New packages have no prior version, so no bump applies — they ship at
 * `localVersion` and are tagged `as-is`. Existing packages prefer the
 * level recorded in `.nice/bump.md`. When no entry is recorded this
 * returns `null` — `[1]`/`[3]` refuse to auto-accept and the user must
 * use `[2] Edit current` to pick a level explicitly. Falling back to
 * `patch` would silently understate breaking changes whose intent was
 * never written down.
 *
 * @param {object} c
 * @returns {"major"|"minor"|"patch"|"as-is"|null}
 */
function recommendedLevel(c) {
  if (c.isNew) return "as-is"
  return c.intentLevel || null
}

/**
 * True when the candidate has changes but no recorded bump intent and is
 * not a brand-new package. These rows are blocked from auto-acceptance.
 *
 * @param {object} c
 * @returns {boolean}
 */
function requiresManualLevel(c) {
  return !c.isNew && !c.intentLevel
}

module.exports = { enrichWithIntent, recommendedLevel, requiresManualLevel }
