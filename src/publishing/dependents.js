/**
 * @fileoverview Dependent bump decisions
 *
 * Decides how a package pulled in by reverse-dependency resolution is
 * versioned, and which packages must be dropped from a run because they
 * depend on a never-published package that the user skipped.
 *
 * Rules for a dependent (see `classifyDependent`):
 * - Never published (`isNew`) → FIRST_PUBLISH: joins the prompt walk; its
 *   first version is its local version as-is unless the user decides otherwise.
 * - Has `.nice/bump.md` entries → INTENT: joins the prompt walk with the level
 *   recommended from its entries (highest wins), exactly like a requested package.
 * - Otherwise → AUTO_PATCH: its only change is a rebuilt dependency, so it is
 *   patch-bumped without a prompt.
 *
 * @module publisher/dependents
 */

const { gray, yellow } = require("../shared/logger")
const { calcVersion } = require("./versioning")

/**
 * How a dependent is versioned.
 * @constant
 */
const DEPENDENT_KIND = {
  AUTO_PATCH: "auto-patch",
  INTENT: "intent",
  FIRST_PUBLISH: "first-publish",
}

/**
 * Classifies a dependent candidate. The candidate must already carry the
 * intent fields from `enrichWithIntent` — an unenriched candidate would
 * otherwise read as "no bump notes" and be silently auto-patched.
 *
 * @param {{ name: string, isNew: boolean, intentLevel?: string|null }} candidate
 * @returns {"auto-patch"|"intent"|"first-publish"}
 */
function classifyDependent(candidate) {
  if (!("intentLevel" in candidate)) {
    throw new TypeError(`classifyDependent: ${candidate.name} has no intent data (run enrichWithIntent first)`)
  }
  if (candidate.isNew) return DEPENDENT_KIND.FIRST_PUBLISH
  if (candidate.intentLevel) return DEPENDENT_KIND.INTENT
  return DEPENDENT_KIND.AUTO_PATCH
}

/**
 * Splits candidates into the prompt walk and the auto-patched set.
 *
 * @param {object[]} changedCandidates - Requested/changed packages (enriched)
 * @param {object[]} dependentCandidates - Graph-resolved dependents (enriched)
 * @returns {{ walk: object[], autoPatch: object[] }} `walk` = changed packages
 *   followed by intent / first-publish dependents; `autoPatch` = pure
 *   dependents with `newVersion` and `bumpType: "patch"` resolved.
 */
function partitionCandidates(changedCandidates, dependentCandidates) {
  const walk = [...changedCandidates]
  const autoPatch = []
  for (const c of dependentCandidates) {
    if (classifyDependent(c) === DEPENDENT_KIND.AUTO_PATCH) {
      autoPatch.push({ ...c, newVersion: calcVersion(c.localVersion, "patch"), bumpType: "patch" })
    } else {
      walk.push(c)
    }
  }
  return { walk, autoPatch }
}

/**
 * Drops every package that depends on a never-published candidate which is
 * not in the publish list (the user skipped it). A dropped package that is
 * itself never-published blocks its own dependents in turn.
 *
 * @param {{ name: string, isNew?: boolean }[]} toPublish - Accepted packages
 * @param {{ name: string, isNew?: boolean }[]} candidates - Every candidate considered this run
 * @param {Map<string, Set<string>>} reverseMap - Package → packages that depend on it
 * @returns {{ kept: object[], dropped: { name: string, blockedBy: string }[] }}
 */
function excludeBlockedByUnpublished(toPublish, candidates, reverseMap) {
  const publishing = new Map(toPublish.map(p => [p.name, p]))
  const queue = candidates.filter(c => c.isNew && !publishing.has(c.name)).map(c => c.name)
  const dropped = []

  while (queue.length > 0) {
    const unpublished = queue.shift()
    for (const dependent of reverseMap.get(unpublished) || []) {
      const p = publishing.get(dependent)
      if (!p) continue
      publishing.delete(dependent)
      dropped.push({ name: dependent, blockedBy: unpublished })
      if (p.isNew) queue.push(dependent)
    }
  }

  return { kept: toPublish.filter(p => publishing.has(p.name)), dropped }
}

/**
 * Plain-text plan tag for a candidate: `"FIRST publish"` for a never-published
 * package, `"dependent, bump notes"` for an intent-driven dependent,
 * `"dependent"` for a pure dependent, joined with ", "; `""` when none apply.
 *
 * @param {object} candidate - Enriched candidate
 * @returns {string}
 */
function planTag(candidate) {
  const parts = []
  if (candidate.isNew) parts.push("FIRST publish")
  if (candidate.isDependent) {
    parts.push(
      !candidate.isNew && classifyDependent(candidate) === DEPENDENT_KIND.INTENT
        ? "dependent, bump notes"
        : "dependent"
    )
  }
  return parts.join(", ")
}

/**
 * Colored ` (tag)` suffix for plan/candidate rows — yellow for a first
 * publish, gray otherwise; `""` when the candidate has no tag.
 *
 * @param {object} candidate - Enriched candidate
 * @returns {string}
 */
function formatPlanTag(candidate) {
  const tag = planTag(candidate)
  if (!tag) return ""
  return (candidate.isNew ? yellow : gray)(` (${tag})`)
}

module.exports = {
  DEPENDENT_KIND,
  classifyDependent,
  partitionCandidates,
  excludeBlockedByUnpublished,
  planTag,
  formatPlanTag,
}
