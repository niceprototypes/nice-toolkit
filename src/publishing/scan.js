/**
 * @fileoverview Package change discovery
 *
 * Scans registered packages to find which ones have changes since their
 * last published version. Supports two modes:
 * - Explicit: user provides package names, dependency graph resolves the rest
 * - Auto-scan: checks all registered packages against their publish tags
 *
 * @module publisher/scan
 */

const fs = require("fs")
const { ALL_PACKAGES } = require("./constants")
const { pkgDir, getNpmVersion, getLocalVersion, getChangeStatus } = require("./helpers")
const { resolveAffected } = require("./graph")
const { readBumpIntent } = require("../shared/bump")
const { runTasks, createTableReporter } = require("../shared/tasks")
const { glyphFor } = require("../shared/tasks/status")
const { gray, yellow, red } = require("../shared/logger")

/**
 * Maps a settled scan task to its aligned table row: `[package, changes,
 * latest entry]`. Cells are colored here; the table reporter only aligns them.
 * The Changes cell is already colored by the task (blank / yellow / red); the
 * Latest-entry cell (the most recent `.nice/bump.md` message) renders gray.
 *
 * @param {string} label - Package name.
 * @param {object} outcome - Settled outcome carrying `changes` and `entry`.
 * @returns {string[]} One colored cell per header.
 */
function scanRow(label, outcome) {
  return [`${glyphFor(outcome)} ${label}`, outcome.changes || "", outcome.entry ? gray(outcome.entry) : ""]
}

/**
 * Whether a registered package has a directory on disk. Returns false
 * for registry entries whose source folder isn't checked out locally.
 *
 * @param {string} name - Package name
 * @returns {boolean}
 */
function packageExistsLocally(name) {
  try {
    fs.statSync(pkgDir(name))
    return true
  } catch {
    return false
  }
}

/**
 * Discovers which packages have publishable changes.
 *
 * When requestedPackages is provided, resolves the full dependency graph
 * and includes all affected packages. Otherwise scans every registered
 * package for commits since its last publish tag.
 *
 * @param {string[]} [requestedPackages] - Explicitly changed package names
 * @returns {{ candidates: object[], changedSet: Set<string>|null, dependentSet: Set<string>|null }}
 */
async function scanPackages(requestedPackages) {
  const candidates = []
  let changedSet = null
  let dependentSet = null

  // Resolve the package set + dependent membership up front, so each package
  // can be scanned as its own task.
  let names
  if (requestedPackages && requestedPackages.length > 0) {
    const resolved = resolveAffected(requestedPackages)
    changedSet = resolved.changed
    dependentSet = resolved.dependents
    names = [...changedSet, ...dependentSet].filter(packageExistsLocally)
  } else {
    names = ALL_PACKAGES.filter(packageExistsLocally)
  }

  // One task per package — the shared reporter checks each off as it resolves
  // (✓ for a candidate, ⊘ for an unchanged skip), the same list UI build/dedupe
  // use. Sequential, so candidates accumulate in name order.
  const tasks = names.map(name => ({
    label: name,
    activeLabel: `Scanning ${name}`,
    run: async () => {
      const localVersion = getLocalVersion(name)
      const npmVersion = await getNpmVersion(name)
      const { commitsSincePublish, dirty, hasTag } = getChangeStatus(name, npmVersion)

      // The package's bump intent, read once: its presence drives the yellow/red
      // Changes color, and its most recent message is the Latest-entry column.
      const { entries } = readBumpIntent(pkgDir(name))
      const entry = entries.length > 0 ? entries[entries.length - 1].message : ""

      // Real change signals, independent of a force-include: bumped-but-unpublished,
      // never published, commits since a publish tag, or uncommitted work.
      const hasChanges =
        (npmVersion && localVersion !== npmVersion) ||
        !npmVersion ||
        (hasTag && commitsSincePublish > 0) ||
        dirty > 0
      // Requested packages (and their graph dependents) are always candidates;
      // an auto-scan only qualifies a package that actually has changes.
      const isDependent = dependentSet ? dependentSet.has(name) : false
      const qualifies = dependentSet ? true : hasChanges

      // Non-candidates still get a table row — an empty Changes cell.
      if (!qualifies) return { kind: "skipped", changes: "", entry }

      candidates.push({
        name,
        localVersion,
        npmVersion,
        commitsSincePublish,
        dirty,
        isNew: !npmVersion,
        isDependent,
      })

      // Changes cell for the table. Uncommitted work is flagged: yellow, or RED
      // when the package has no recorded bump intent (.nice/bump.md empty) — you
      // have local changes but haven't declared how to version them. A package
      // named on the CLI but with no real change reads "requested", not "changes".
      let changes
      if (!npmVersion) {
        changes = "new"
      } else if (dirty > 0) {
        const label = `${dirty} uncommitted`
        changes = entries.length > 0 ? yellow(label) : red(label)
      } else if (isDependent) {
        changes = "dependent"
      } else if (hasChanges) {
        changes = "changes"
      } else {
        changes = "requested"
      }
      return { kind: "done", changes, entry }
    },
  }))

  // Render an aligned Package / Changes / Latest-entry table (col widths from
  // visible width, so colored cells still line up) once every task has settled.
  const reporter = createTableReporter({ headers: ["", "Changes", "Latest entry"], toRow: scanRow })
  await runTasks(tasks, { reporter, summary: false })
  return { candidates, changedSet, dependentSet }
}

module.exports = { scanPackages }