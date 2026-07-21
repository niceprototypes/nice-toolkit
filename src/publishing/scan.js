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
const { runTasks } = require("../shared/tasks")

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

      // Requested packages (and their graph dependents) are always candidates.
      // An auto-scan qualifies a package on any of: bumped-but-unpublished,
      // never published, real commits since a publish tag, or uncommitted work.
      const isDependent = dependentSet ? dependentSet.has(name) : false
      const qualifies = dependentSet
        ? true
        : (npmVersion && localVersion !== npmVersion) ||
          !npmVersion ||
          (hasTag && commitsSincePublish > 0) ||
          dirty > 0

      if (!qualifies) return { kind: "skipped", detail: "no changes" }

      candidates.push({
        name,
        localVersion,
        npmVersion,
        commitsSincePublish,
        dirty,
        isNew: !npmVersion,
        isDependent,
      })

      const detail = !npmVersion
        ? "new"
        : dirty > 0
          ? `${dirty} uncommitted`
          : isDependent
            ? "dependent"
            : "changes"
      return { kind: "done", detail }
    },
  }))

  await runTasks(tasks, { verb: "scanned", summary: false })
  return { candidates, changedSet, dependentSet }
}

module.exports = { scanPackages }