/**
 * @fileoverview Candidate display formatting.
 *
 * Prints package candidates discovered by the publisher scan, grouped by
 * publish tier with aligned columns. The package name color is the
 * readiness signal:
 *
 * - Green name → working tree clean, ready to publish
 * - Yellow name → uncommitted changes, needs attention
 *
 * Sample output (with colors stripped):
 *
 *     ── Tier 0 ──
 *     nice-styles    6.0.2 → 6.0.3   committed
 *     nice-icons     1.1.0 → 1.1.0
 *
 *     ── Tier 1 ──
 *     nice-react-styles  4.0.3 → 4.0.4   2 uncommitted
 *
 *     ── Tier 2 ──
 *     nice-react-flex    2.1.0 → 2.1.1   committed (dependent)
 *
 * @module publisher/display
 */

const { cyan, gray, green, yellow } = require("../shared/logger")
const { getTierIndexMap } = require("../shared/registry")
const { formatPlanTag } = require("./dependents")

/**
 * Fallback tier for candidates whose name is not in the registry.
 * Chosen high enough to sort below every real tier so unknown packages
 * still render but at the bottom.
 */
const UNKNOWN_TIER_INDEX = 99

/**
 * Matches a single ANSI SGR escape sequence (e.g. `\x1b[31m`, `\x1b[0m`).
 * Used to strip color codes when measuring visible string width.
 */
const ANSI_SGR_PATTERN = /\x1b\[\d+m/g

/**
 * @typedef {object} Candidate
 * @property {string} name - Package name (e.g. `"nice-react-button"`)
 * @property {string} npmVersion - Version currently published to npm; empty string when unpublished
 * @property {string} localVersion - Version in the local `package.json`
 * @property {boolean} isNew - True when the package has never been published
 * @property {boolean} isDependent - True when this candidate was added by reverse-dependency resolution (not by a direct source change)
 * @property {number} dirty - Count of uncommitted files in the working tree (0 = clean)
 */

/**
 * Pads a string with trailing spaces to a target *visible* width.
 *
 * Counts only printable characters, not ANSI color escapes, so a colored
 * string aligns with an uncolored string of the same visible text.
 *
 * @param {string} text - May contain ANSI escapes
 * @param {number} visibleWidth - Target column width measured in printable chars
 * @returns {string} `text` plus enough trailing spaces to reach `visibleWidth`, or `text` unchanged if it already meets/exceeds the width
 */
function padVisible(text, visibleWidth) {
  const visibleText = text.replace(ANSI_SGR_PATTERN, "")
  const padding = visibleWidth - visibleText.length
  return padding > 0 ? text + " ".repeat(padding) : text
}

/**
 * Renders a candidate's version column text.
 *
 * @param {Candidate} candidate
 * @param {object} [options]
 * @param {boolean} [options.colorize=false] - When true, wraps the local version in cyan
 * @returns {string} `"New"` for unpublished packages, otherwise `"{npm} → {local}"`
 */
function formatVersionCell(candidate, { colorize = false } = {}) {
  if (candidate.isNew) return "New"
  const local = colorize ? cyan(candidate.localVersion) : candidate.localVersion
  return `${candidate.npmVersion} → ${local}`
}

/**
 * Groups candidates by their publish tier. Candidates whose name is not
 * in the registry land in `UNKNOWN_TIER_INDEX` so they still render.
 *
 * @param {Candidate[]} candidates
 * @returns {Map<number, Candidate[]>} Tier index → candidates in input order
 */
function groupCandidatesByTier(candidates) {
  const tierIndexByName = getTierIndexMap()
  const candidatesByTier = new Map()
  for (const candidate of candidates) {
    const tierIndex = tierIndexByName.get(candidate.name) ?? UNKNOWN_TIER_INDEX
    if (!candidatesByTier.has(tierIndex)) {
      candidatesByTier.set(tierIndex, [])
    }
    candidatesByTier.get(tierIndex).push(candidate)
  }
  return candidatesByTier
}

/**
 * Prints discovered candidates to stdout, grouped by publish tier with
 * aligned columns.
 *
 * Row layout:
 *
 *     {name}  {version}  {status}{tag}
 *
 * Column rules:
 * - **name**: green when working tree is clean, yellow when dirty
 * - **version**: `"New"` (yellow) for unpublished packages, otherwise
 *   `"{npm} → {local}"` with the local part in cyan
 * - **status**: `"{n} uncommitted"` (yellow) when there are uncommitted
 *   files, `"committed"` (green) when the local version has moved past
 *   the published version, empty otherwise
 * - **tag**: `formatPlanTag` — `" (FIRST publish)"` (yellow) for a
 *   never-published package; `" (dependent)"` / `" (dependent, bump notes)"`
 *   (gray) when the candidate was pulled in by reverse-dependency resolution
 *   (candidates must be enriched with `.nice/bump.md` intent)
 *
 * @param {Candidate[]} candidates - Output of the publisher scan
 * @returns {void}
 */
function displayCandidates(candidates) {
  // Column widths derived from the data so every row aligns regardless
  // of name/version length variance.
  const nameColumnWidth = Math.max(...candidates.map(c => c.name.length))
  const versionColumnWidth = Math.max(
    ...candidates.map(c => formatVersionCell(c).length)
  )

  const candidatesByTier = groupCandidatesByTier(candidates)
  const sortedTiers = [...candidatesByTier.entries()].sort(
    ([a], [b]) => a - b
  )

  for (const [tierIndex, tierCandidates] of sortedTiers) {
    console.log(`  ${gray(`── Tier ${tierIndex} ──`)}`)

    for (const candidate of tierCandidates) {
      const hasUncommittedChanges = candidate.dirty > 0
      const hasVersionBumped = candidate.localVersion !== candidate.npmVersion

      // Name color is the readiness signal: green = ready, yellow = blocked.
      const colorizeName = hasUncommittedChanges ? yellow : green
      const nameCell = padVisible(colorizeName(candidate.name), nameColumnWidth)

      const versionCell = candidate.isNew
        ? padVisible(yellow(formatVersionCell(candidate)), versionColumnWidth)
        : padVisible(formatVersionCell(candidate, { colorize: true }), versionColumnWidth)

      // Status is only meaningful when something has actually changed
      // since the last publish — otherwise leave the column blank.
      let statusCell = ""
      if (hasUncommittedChanges) {
        statusCell = yellow(`${candidate.dirty} uncommitted`)
      } else if (hasVersionBumped) {
        statusCell = green("committed")
      }

      console.log(`  ${nameCell}  ${versionCell}  ${statusCell}${formatPlanTag(candidate)}`)
    }
    console.log("")
  }
}

module.exports = { displayCandidates }
