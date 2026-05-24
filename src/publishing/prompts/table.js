const { info, cyan, gray, green, red, yellow } = require("../../shared/logger")
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
//   ENTRIES = bare count (e.g. `0`, `10`)
//   LAST    = `YYYY-MM-DD HH:MM` / `❌ No entries`
const COL_NAME = 24
const COL_VERSION = 28
const COL_LEVEL = 9
const COL_ENTRIES = 9

function renderTable(enriched, decisions, currentIdx) {
  info("Publish candidates:")

  // Header row in gray. The leading two spaces match the row marker width
  // (`▶ ` or `  `) so headers align with the body underneath them.
  const header =
    `  ${"Package".padEnd(COL_NAME)} ` +
    `${"Version".padEnd(COL_VERSION)} ` +
    `${"Level".padEnd(COL_LEVEL)} ` +
    `${"Entries".padEnd(COL_ENTRIES)} ` +
    `Last entry`
  info(gray(header))

  for (let rowIndex = 0; rowIndex < enriched.length; rowIndex++) {
    const candidate = enriched[rowIndex]
    const decision = decisions.get(candidate.name)
    const isCurrent = rowIndex === currentIdx
    const isAccepted = decision && decision.status === "accepted"

    // No-intent rows that haven't been accepted yet render entirely in red.
    // The whole-row red is louder than the previous yellow-status-only and
    // matches the severity: shipping a major change under a silent patch
    // is the failure mode this prompt exists to prevent.
    const isManualPending = !isAccepted && requiresManualLevel(candidate)

    // `chosen` is whatever the row will publish at: the user's accepted
    // decision if present, otherwise the file-derived recommendation. May
    // be null when the candidate has changes but no recorded intent — in
    // that case the Level column shows `(manual)` and the Version column
    // shows a `?` placeholder until the user picks a level via [2].
    const chosen = isAccepted ? decision.bumpType : recommendedLevel(candidate)
    const next = chosen ? derivedVersion(candidate, chosen) : null
    // New packages render `1.0.0 (new)` — no arrow, no level tag, since
    // there is no prior version to bump from. No-intent rows render
    // `1.0.0 → ?` to make the unresolved state visible at a glance.
    const versionText = candidate.isNew
      ? `${candidate.localVersion} (new)`
      : `${candidate.localVersion} → ${next || "?"}`
    const version = versionText.padEnd(COL_VERSION)
    const levelTag = (candidate.isNew ? "" : chosen || "manual").padEnd(COL_LEVEL)

    const count = candidate.intentEntries.length
    const lastEntry = candidate.intentEntries[count - 1]
    // Has-entries rows show the newest timestamp; no-entries rows show the
    // ❌ marker as a self-explanatory failure indicator.
    const lastDate = lastEntry?.timestamp || "❌ No entries"

    if (isManualPending) {
      // Whole row red. Count + ❌ marker make the failure cause and the
      // unresolved last-entry state immediately readable.
      const namePadded = candidate.name.padEnd(COL_NAME)
      const countPadded = String(count).padEnd(COL_ENTRIES)
      info(red(`${isCurrent ? "▶ " : "  "}${namePadded} ${version} ${levelTag} ${countPadded} ${lastDate}`))
      continue
    }

    // Arrow marker + yellow name for the row currently being prompted.
    const prefix = isCurrent ? yellow("▶ ") : "  "
    const name = (isCurrent ? yellow : cyan)(candidate.name.padEnd(COL_NAME))

    // Entries column is just the count, gray when pending, green when the
    // user has accepted a level for the row. The resolved next-version
    // shown in the Version column is the visible signal of acceptance —
    // the ✓ glyph from the old design is redundant.
    const countText = String(count).padEnd(COL_ENTRIES)
    const status = isAccepted ? green(countText) : gray(countText)

    info(`${prefix}${name} ${version} ${levelTag} ${status} ${gray(lastDate)}`)
  }
}

module.exports = { renderTable }
