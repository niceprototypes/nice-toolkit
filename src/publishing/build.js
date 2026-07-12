/**
 * @fileoverview Build phase
 *
 * Builds all packages in dependency order and swaps file: deps to semver
 * for publishing. This is the slow phase — no OTP pressure.
 *
 * @module publisher/build
 */

const path = require("path")
const { readJSON } = require("../shared/fs-utils")
const { info, fail, cyan } = require("../shared/logger")
const { runShell, pkgDir } = require("./helpers")
const { swapFileDepsToSemver } = require("./deps")

/**
 * Builds all packages and swaps their file: deps to semver ranges.
 *
 * Each package's build script runs first, then its package.json deps
 * are swapped from file: references to publishable semver ranges.
 * Build failures are tracked but don't halt the entire process —
 * remaining packages continue building.
 *
 * The swap map is caller-owned and populated in place as each package is
 * swapped, so an exception partway through the loop still leaves the
 * already-swapped packages recorded — the orchestrator's `finally` can then
 * restore them. (If it were a local returned value, a mid-loop throw would
 * strand those swaps with no record to undo.)
 *
 * @param {object[]} toPublish - Packages to build, sorted by dependency order
 * @param {Map<string, object>} swappedDeps - Caller-owned map, populated as name → original dep values
 * @returns {{ publishable: object[], buildFailed: string[], swappedDeps: Map<string, object> }}
 */
function buildPackages(toPublish, swappedDeps = new Map()) {
  const buildFailed = []

  for (const p of toPublish) {
    const dir = pkgDir(p.name)

    try {
      const pkg = readJSON(path.join(dir, "package.json"), { useCache: false })

      // Only run build if the package has a build script
      if (pkg.scripts && pkg.scripts.build) {
        info(`Building ${cyan(p.name)}...`)
        runShell("npm run build", { cwd: dir })
      }
    } catch (e) {
      fail(`Build failed for ${p.name}: ${e.message}`)
      buildFailed.push(p.name)
      continue
    }

    // Swap file: deps to semver for npm publish
    const originals = swapFileDepsToSemver(p.name)
    swappedDeps.set(p.name, originals)
  }

  // Filter out packages that failed to build
  const publishable = toPublish.filter(p => !buildFailed.includes(p.name))

  return { publishable, buildFailed, swappedDeps }
}

module.exports = { buildPackages }