const { warn, cyan, yellow } = require("../../shared/logger")
const { promptKey } = require("../helpers")
const { recommendedLevel } = require("./intent")

/**
 * Inner prompt for [2] Edit current — asks for a specific level.
 *
 * For new packages, only `[y]/[n]` makes sense: the version is fixed at
 * `localVersion`, so accepting returns `as-is` and skipping returns null.
 *
 * For existing packages, the prompt shows `[p]atch / [m]inor / [M]ajor /
 * [s]kip` with the recommendation in parentheses. Pressing Enter (empty
 * answer) accepts the recommendation — this is intentional but not visible
 * from the prompt text, so the empty-string case below is a fallback to
 * `rec`, not a no-op.
 *
 * @param {object} c - Current candidate
 * @returns {Promise<string|null>} bumpType or null to skip
 */
async function promptEditLevel(c) {
  if (c.isNew) {
    const answer = (await promptKey(
      `  ${cyan(c.name)} — new package, [y] accept / [n] skip: `,
      ["y", "Y", "n", "N"]
    )).trim().toLowerCase()
    if (answer === "n") return null
    // Default (Enter or `y`) accepts at the existing version.
    return "as-is"
  }
  const rec = recommendedLevel(c)
  // No-intent rows have no recommendation. The prompt advertises the
  // missing-notes state so the user knows why no `(rec: …)` hint is
  // shown, and pressing Enter falls through to skip rather than to a
  // silent patch.
  const promptText = rec
    ? `  ${cyan(c.name)} — [p]atch / [m]inor / [M]ajor / [s]kip (rec: ${cyan(rec)}): `
    : `  ${cyan(c.name)} — ${yellow("no bump notes")} — [p]atch / [m]inor / [M]ajor / [s]kip: `
  const answer = (await promptKey(promptText, ["p", "m", "M", "s"])).trim()
  // `M` (capital) is intentional — `m` would be ambiguous with minor.
  if (answer === "M") return "major"
  switch (answer) {
    // Enter / empty answer falls back to the recommendation when one
    // exists, or to skip when the row has no recorded intent. Either way
    // the publish workflow never auto-bumps a no-intent row on Enter.
    case "": return rec
    case "p": return "patch"
    case "m": return "minor"
    case "s": return null
    default:
      warn(`Unknown option "${answer}"`)
      return null
  }
}

module.exports = { promptEditLevel }
