/**
 * @fileoverview Version bump prompting
 *
 * Per-package walkthrough driven by recorded bump intent in `.nice/bump.md`.
 * For each iteration, the full candidate table is re-rendered with the
 * current package highlighted, and a letter-keyed menu is shown:
 *
 *   [a]pprove current       Apply the recommended level, advance
 *   [e]dit current          Prompt for a specific level, advance
 *   approve [r]emaining     Apply recommendations to this and every
 *                           remaining pending package, finish
 *   [v]iew logs             Print .nice/bump.md entries for current,
 *                           re-prompt (does not advance)
 *   [Esc] Cancel            Abort the publish
 *
 * Accepted rows show their count in green; the resolved next-version
 * appears in the Version column. Dependents (auto-patched) are never
 * part of this walk.
 *
 * **No-intent gate.** Existing packages that have changes but no entries
 * in `.nice/bump.md` cannot be auto-accepted. The whole row renders in
 * red with `0` in the Entries column and `❌ No entries` in the Last
 * entry column. The menu adapts based on the no-intent state:
 *
 *   - `[a]pprove current` is omitted from the menu when the current row
 *     has no bump notes — there is no recommended level to apply.
 *   - `approve [r]emaining` is omitted when any remaining pending row
 *     has no bump notes — pressing it would just bounce the cursor to
 *     the first no-notes row anyway.
 *
 * The user must use `[e]dit current` to pick a level explicitly for any
 * no-notes row. This prevents silently shipping a major-impact refactor
 * under a patch bump just because nobody recorded intent.
 *
 * Input: `a` / `e` / `r` / `v` are the menu keys. Esc (or empty Enter)
 * cancels. The inner edit prompt accepts `p` / `m` / `M` / `s`, with
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

    // [a]pprove is only meaningful when the current row has bump notes —
    // otherwise there's nothing to approve, because no level was recommended.
    // approve [r]emaining is only meaningful when no remaining pending row
    // needs a manual level — otherwise the user would press it and
    // immediately bounce into the first no-notes row anyway. Hiding the
    // options upfront beats presenting them and rejecting the keystroke.
    const currentIsManual = requiresManualLevel(current)
    const anyManualRemaining = enriched.slice(currentIdx).some(
      (c) => decisions.get(c.name).status === "pending" && requiresManualLevel(c)
    )

    // `\x1b` (Escape byte) must be explicitly accepted for bare-Esc to
    // resolve in promptKey — the helper's `acceptKeys.includes('\x1b')`
    // gate filters it out otherwise. Enter is always handled separately by
    // promptKey and resolves to `""` regardless of acceptedKeys.
    const menuParts = []
    const acceptedKeys = ["e", "v", "\x1b"]
    if (!currentIsManual) {
      menuParts.push("[A]pprove current")
      acceptedKeys.push("a")
    }
    menuParts.push("[E]dit current")
    if (!anyManualRemaining) {
      menuParts.push("Approve [r]emaining")
      acceptedKeys.push("r")
    }
    menuParts.push("[V]iew logs")
    menuParts.push("[Esc] Cancel")

    const rawAction = (await promptKey(menuParts.join("\n") + "\n: ", acceptedKeys)).trim()
    const action = rawAction.toLowerCase()

    // [Esc] / Enter / `c` / `cancel` — abort the entire publish, returning
    // null to the caller so no version bumps are committed. Bare Enter
    // (resolves to "") and `c` / `cancel` remain accepted for the non-TTY
    // fallback path (full-line prompt).
    if (action === "\x1b" || action === "" || action === "c" || action === "cancel") {
      info("Aborted.")
      return null
    }

    // `continue` (not currentIdx++) so the cursor stays on the same row.
    if (action === "v") {
      if (current.intentEntries.length > 0) {
        for (const e of current.intentEntries) {
          const ts = e.timestamp ? `[${e.timestamp}] ` : ""
          const mark = e.consumed ? "✓ " : ""
          info(`    ${ts}${mark}${e.level}: ${e.message}`)
        }
      }
      continue
    }

    // approve [r]emaining — accept the current row and every subsequent
    // pending row at their recommended levels in one shot. Already-accepted
    // rows (reached via earlier [e] backtracking, hypothetically) are
    // skipped so a user-edited level is never overwritten. No-intent rows
    // are also skipped — they require [e]dit to pick a level explicitly.
    // If any were skipped the cursor jumps to the first one so the user
    // can address it; otherwise the loop terminates as before.
    if (action === "r") {
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
        info("Use [e]dit current to choose a level for each.")
        currentIdx = enriched.indexOf(skipped[0])
        continue
      }
      currentIdx = enriched.length
      // Final render with no current row highlighted (-1) so the user sees
      // the completed walk before control returns.
      renderTable(enriched, decisions, -1)
      break
    }

    // [e]dit — open the inner level prompt. A null return means the user
    // chose [s]kip; the row stays `pending` and the cursor still advances.
    if (action === "e") {
      const bumpType = await promptEditLevel(current)
      if (bumpType !== null) {
        decisions.set(current.name, { status: "accepted", bumpType })
      }
      currentIdx++
      continue
    }

    // [a]pprove — accept the recommendation and advance. No-intent rows are
    // refused defensively (the menu hides the option for those rows, so
    // this guard only fires if the user types `a` through a non-TTY path).
    if (action === "a") {
      if (requiresManualLevel(current)) {
        warn(
          `${current.name} has no bump notes in .nice/bump.md. Use [e]dit current to pick a level.`
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
