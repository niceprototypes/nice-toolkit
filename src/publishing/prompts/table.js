const { info, cyan, gray, green, yellow } = require("../../shared/logger")
const { recommendedLevel, requiresManualLevel } = require("./intent")
const { derivedVersion } = require("./version")

/**
 * Prints the candidate table with the current row highlighted. Called once
 * per iteration of the main loop so progressive ✓ marks become visible as
 * the user advances through the walk.
 *
 * @param {object[]} enriched - candidates with intent attached
 * @param {Map<string, Decision>} decisions - per-candidate lifecycle map
 * @param {number} currentIdx - index of the row being prompted on (-1 to
 *   render with no row highlighted, used after [3] Accept remaining)
 */
// Column widths used by both the header and each body row. Kept as constants
// so the two stay in lock-step — change one, change the other implicitly.
// Widths are sized for the worst-case content each column can hold:
//   NAME    = `nice-react-device-detector` etc. (longest current package)
//   VERSION = `999.999.999 → 999.999.999` plus the unicode arrow glyph
//   LEVEL   = `(major)` / `(as-is)` / blank — 8 with one trailing space
//   STATUS  = `✓ 999.999.999` / `10 entries` / blank
//   LAST    = `YYYY-MM-DD HH:MM`
const COL_NAME = 24
const COL_VERSION = 28
const COL_LEVEL = 9
const COL_STATUS = 14

function renderTable(enriched, decisions, currentIdx) {
  info("Publish candidates:")

  // Header row in gray. The leading two spaces match the row marker width
  // (`▶ ` or `  `) so headers align with the body underneath them.
  const header =
    `  ${"Package".padEnd(COL_NAME)} ` +
    `${"Version".padEnd(COL_VERSION)} ` +
    `${"Level".padEnd(COL_LEVEL)} ` +
    `${"Status".padEnd(COL_STATUS)} ` +
    `Last entry`
  info(gray(header))

  for (let rowIndex = 0; rowIndex < enriched.length; rowIndex++) {
    const candidate = enriched[rowIndex]
    const decision = decisions.get(candidate.name)
    const isCurrent = rowIndex === currentIdx

    // Arrow marker + yellow name for the row currently being prompted.
    const prefix = isCurrent ? yellow("▶ ") : "  "
    const name = (isCurrent ? yellow : cyan)(candidate.name.padEnd(COL_NAME))

    // `chosen` is whatever the row will publish at: the user's accepted
    // decision if present, otherwise the file-derived recommendation. May
    // be null when the candidate has changes but no recorded intent — in
    // that case the Level column shows `(manual)` and the Version column
    // shows a `?` placeholder until the user picks a level via [2].
    const chosen = decision && decision.status === "accepted" ? decision.bumpType : recommendedLevel(candidate)
    const next = chosen ? derivedVersion(candidate, chosen) : null
    // New packages render `1.0.0 (new)` — no arrow, no level tag, since
    // there is no prior version to bump from. No-intent rows render
    // `1.0.0 → ?` to make the unresolved state visible at a glance.
    const versionText = candidate.isNew
      ? `${candidate.localVersion} (new)`
      : `${candidate.localVersion} → ${next || "?"}`
    const version = versionText.padEnd(COL_VERSION)
    const levelTag = (candidate.isNew ? "" : chosen ? `(${chosen})` : "(manual)").padEnd(COL_LEVEL)

    // Status column — four mutually exclusive shapes, padded to a uniform
    // visible width before color is applied so trailing columns line up:
    //   accepted              → green check + resolved version
    //   pending + has intent  → gray "{n} entries" hint
    //   pending + no intent   → yellow "! no bump notes" warning (manual input required)
    //   new package           → blank
    let status
    if (decision && decision.status === "accepted") {
      status = green(`✓ ${next}`.padEnd(COL_STATUS))
    } else if (requiresManualLevel(candidate)) {
      status = yellow("! no bump notes".padEnd(COL_STATUS))
    } else {
      const count = candidate.intentEntries.length
      const text = candidate.intentLevel
        ? `${count} ${count === 1 ? "entry" : "entries"}`
        : ""
      status = candidate.intentLevel ? gray(text.padEnd(COL_STATUS)) : text.padEnd(COL_STATUS)
    }

    // Last entry timestamp. Entries are file-order (oldest first) so the
    // newest is the last element. Empty string for new packages and any
    // package whose `.nice/bump.md` has no parsed entries — keeps the
    // column visually clean rather than printing a placeholder.
    const lastEntry = candidate.intentEntries[candidate.intentEntries.length - 1]
    const lastDate = lastEntry?.timestamp || ""

    info(`${prefix}${name} ${version} ${levelTag} ${status} ${gray(lastDate)}`)
  }
}

module.exports = { renderTable }
