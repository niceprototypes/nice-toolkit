/**
 * @fileoverview Version bump prompting
 *
 * Per-package walkthrough driven by recorded bump intent in `.nice/bump.md`.
 * For each iteration, the full candidate table is re-rendered with the
 * current package highlighted, and a 5-option menu is shown:
 *
 *   [1] Accept current      Apply the recommended level, advance
 *   [2] Edit current        Prompt for a specific level, advance
 *   [3] Accept remaining    Apply recommendations to this and every
 *                           remaining pending package, finish
 *   [4] View logs           Print .nice/bump.md entries for current,
 *                           re-prompt (does not advance)
 *   [5] Cancel              Abort the publish
 *
 * Accepted rows replace their entry-count tag with a green ✓ + derived
 * version. Dependents (auto-patched) are never part of this walk.
 *
 * **No-intent gate.** Existing packages that have changes but no entries
 * in `.nice/bump.md` cannot be auto-accepted. The Level column shows
 * `(manual)` and the Status column shows a yellow `! no bump notes`
 * warning. `[1] Accept current` and `[3] Accept remaining` refuse to
 * auto-apply a level for these rows — the user must use `[2] Edit
 * current` to pick a level explicitly. This prevents silently shipping a
 * major-impact refactor under a patch bump just because nobody recorded
 * intent.
 *
 * Input: digits `1`–`5` and the letter aliases `a` (accept), `e` (edit),
 * `r` (remaining), `v` (view), `c` (cancel) are all accepted at the main
 * menu. Pressing Enter at the main menu is equivalent to `[1] Accept
 * current`. The inner edit prompt accepts `p` / `m` / `M` / `s`, with
 * Enter falling back to the recommended level (or, when no intent is
 * recorded, to skip).
 *
 * @module publisher/prompts
 *
 * @typedef {object} Decision
 * @property {"pending"|"accepted"} status - lifecycle state for a candidate
 * @property {string} [bumpType] - "major"|"minor"|"patch"|"as-is" — set when status="accepted"
 */

const { info, warn } = require("../../shared/logger")
const { promptKey } = require("../helpers")
const { calcVersion } = require("../versioning")
const { enrichWithIntent, recommendedLevel, requiresManualLevel } = require("./intent")
const { derivedVersion } = require("./version")
const { renderTable } = require("./table")
const { promptEditLevel } = require("./edit-level")

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Walks the user through each changed candidate with a 5-option menu.
 *
 * @param {object[]} changedCandidates - Packages the user explicitly changed
 * @param {object[]} dependentCandidates - Packages added by graph resolution (auto-patched)
 * @returns {Promise<object[]|null>} Packages to publish with newVersion, or null if aborted
 */
async function promptVersionBumps(changedCandidates, dependentCandidates) {
  const enriched = enrichWithIntent(changedCandidates)

  // `decisions` is the source of truth for what each candidate will publish
  // at. Every candidate begins `pending` and transitions to `accepted`
  // exactly once. Skipping a row in [2] Edit current leaves it `pending`
  // and it is dropped from `toPublish` at the end.
  /** @type {Map<string, Decision>} */
  const decisions = new Map()
  for (const c of enriched) decisions.set(c.name, { status: "pending" })

  let currentIdx = 0

  while (currentIdx < enriched.length) {
    const current = enriched[currentIdx]
    // Re-render every iteration so accepted ✓ marks appear progressively as
    // the user advances. The cost is trivial (a few lines of console output
    // per keystroke).
    renderTable(enriched, decisions, currentIdx)

    const action = (await promptKey(
      "[1] Accept current  [2] Edit current  [3] Accept remaining  [4] View logs  [Esc] Cancel: ",
      ["1", "2", "3", "4", ""]
    )).trim()

    // [Esc] / c / cancel — abort the entire publish, returning null to the
    // caller so no version bumps are committed. `c`/`cancel` remain
    // accepted for the non-TTY fallback path (full-line prompt).
    if (action === "" || action.toLowerCase() === "c" || action.toLowerCase() === "cancel") {
      info("Aborted.")
      return null
    }

    // [4] / v — print this candidate's bump entries and re-prompt. Uses
    // `continue` (not currentIdx++) so the cursor stays on the same row.
    if (action === "4" || action.toLowerCase() === "v") {
      if (current.intentEntries.length > 0) {
        for (const e of current.intentEntries) {
          const ts = e.timestamp ? `[${e.timestamp}] ` : ""
          const mark = e.consumed ? "✓ " : ""
          info(`    ${ts}${mark}${e.level}: ${e.message}`)
        }
      }
      continue
    }

    // [3] / r — accept the current row and every subsequent pending row at
    // their recommended levels in one shot. Already-accepted rows (reached
    // via earlier [2] backtracking, hypothetically) are skipped so a
    // user-edited level is never overwritten. No-intent rows are also
    // skipped — they require [2] to pick a level explicitly. If any were
    // skipped the cursor jumps to the first one so the user can address
    // it; otherwise the loop terminates as before.
    if (action === "3" || action.toLowerCase() === "r") {
      const skipped = []
      for (let i = currentIdx; i < enriched.length; i++) {
        const c = enriched[i]
        if (decisions.get(c.name).status === "accepted") continue
        if (requiresManualLevel(c)) {
          skipped.push(c)
          continue
        }
        decisions.set(c.name, { status: "accepted", bumpType: recommendedLevel(c) })
      }
      if (skipped.length > 0) {
        warn(
          `${skipped.length} package(s) skipped (no bump notes): ${skipped.map((c) => c.name).join(", ")}`
        )
        info("Use [2] Edit current to choose a level for each.")
        currentIdx = enriched.indexOf(skipped[0])
        continue
      }
      currentIdx = enriched.length
      // Final render with no current row highlighted (-1) so the user sees
      // the completed walk before control returns.
      renderTable(enriched, decisions, -1)
      break
    }

    // [2] / e — open the inner level prompt. A null return means the user
    // chose [s]kip; the row stays `pending` and the cursor still advances.
    if (action === "2" || action.toLowerCase() === "e") {
      const bumpType = await promptEditLevel(current)
      if (bumpType !== null) {
        decisions.set(current.name, { status: "accepted", bumpType })
      }
      currentIdx++
      continue
    }

    // [1] / Enter / a — accept the recommendation and advance. Empty input
    // is treated as `[1]` here, so the most common path (Enter through a
    // batch) requires zero modifier keys. No-intent rows are refused —
    // the user must pick a level explicitly via [2].
    if (action === "1" || action === "" || action.toLowerCase() === "a") {
      if (requiresManualLevel(current)) {
        warn(
          `${current.name} has no bump notes in .nice/bump.md. Use [2] Edit current to pick a level.`
        )
        continue
      }
      decisions.set(current.name, { status: "accepted", bumpType: recommendedLevel(current) })
      currentIdx++
      continue
    }

    warn(`Unknown option "${action}"`)
  }

  // Materialize the publish list. Only `accepted` rows ship — anything left
  // `pending` (skipped via [2]→s) is intentionally dropped.
  const toPublish = []
  for (const c of enriched) {
    const d = decisions.get(c.name)
    if (!d || d.status !== "accepted") continue
    toPublish.push({ ...c, newVersion: derivedVersion(c, d.bumpType), bumpType: d.bumpType })
  }

  // Dependents are auto-patched unconditionally — they never appear in the
  // walk above. The assumption is that a dependent only needs republishing
  // because one of its `file:` deps changed, and a patch bump is enough to
  // signal "rebuild against the new dependency."
  for (const c of dependentCandidates) {
    toPublish.push({ ...c, newVersion: calcVersion(c.localVersion, "patch"), bumpType: "patch" })
  }

  return toPublish
}

module.exports = { promptVersionBumps }
