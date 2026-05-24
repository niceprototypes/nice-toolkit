/**
 * @fileoverview Main publish workflow orchestrator
 *
 * Thin coordinator that calls each phase in sequence:
 * 1. Scan — discover packages with changes since last publish
 * 2. Display — show candidates grouped by tier
 * 3. Prompt — collect version bump decisions
 * 4. Sort — order by dependency chain
 * 5. Confirm — show plan and get final approval
 * 6. Bump — write new versions to package.json
 * 7. Build — compile all packages, swap deps to semver
 * 8. Release — verify npm auth, publish to npm with OTP management
 * 9. Finalize — restore deps, commit, tag, push, summarize
 *
 * The npm auth check is deferred until step 8 so scan/display/prompt/build
 * (the time-consuming phases that don't need npm credentials) can run without
 * blocking on `npm login`.
 *
 * @module publisher
 */

const { log, info, cyan, green, gray } = require("../shared/logger")
const { verifyNpmAuth } = require("./npm-auth")
const { prompt } = require("./helpers")
const { PUBLISH_TIERS, ALL_PACKAGES } = require("./constants")
const { bumpVersion } = require("./versioning")
const { resolveAffected, buildReverseDependencyMap } = require("./graph")
const { scanPackages } = require("./scan")
const { displayCandidates } = require("./display")
const { promptVersionBumps } = require("./prompts")
const { buildPackages } = require("./build")
const { releasePackages } = require("./release")
const { restoreAllDeps, commitAndTag, printSummary } = require("./finalize")

/**
 * Runs the full publish workflow.
 *
 * @param {object} options
 * @param {string[]} [options.packages] - Packages with actual changes
 * @param {boolean} [options.doPublish=true] - Whether to publish to npm
 * @param {boolean} [options.dryRun=false] - Preview mode
 * @returns {Promise<void>}
 */
async function publish({ packages: requestedPackages, doPublish = true, dryRun = false } = {}) {
  log("Scanning packages...\n")

  // ── 1. Discover candidates ────────────────────────────────────────────────
  const { candidates } = scanPackages(requestedPackages)

  if (candidates.length === 0) {
    info("No packages have changes to publish.")
    return
  }

  // ── 2. Display candidates grouped by tier ─────────────────────────────────
  console.log("")
  log("Packages with changes:\n")
  displayCandidates(candidates)
  console.log("")

  // ── 3. Prompt for version bumps ───────────────────────────────────────────
  const changedCandidates = candidates.filter(c => !c.isDependent)
  const dependentCandidates = candidates.filter(c => c.isDependent)

  const toPublish = await promptVersionBumps(changedCandidates, dependentCandidates)

  // null means user aborted
  if (!toPublish) return

  if (toPublish.length === 0) {
    info("Nothing to publish.")
    return
  }

  // ── 4. Sort by dependency order ───────────────────────────────────────────
  const orderMap = new Map()
  let orderIndex = 0
  for (const tier of PUBLISH_TIERS) {
    for (const name of tier) {
      orderMap.set(name, orderIndex)
    }
    orderIndex++
  }
  toPublish.sort((a, b) => (orderMap.get(a.name) || 99) - (orderMap.get(b.name) || 99))

  // ── 5. Confirm plan ──────────────────────────────────────────────────────
  console.log("")
  log("Publish plan:\n")
  for (const p of toPublish) {
    const tag = p.isDependent ? gray(" (dependent)") : ""
    console.log(`  ${cyan(p.name)}  ${p.localVersion} → ${green(p.newVersion)}${tag}`)
  }
  console.log("")

  if (dryRun) {
    info("Dry run — no changes made.")
    return
  }

  const confirmAnswer = await prompt("Proceed? [Y/n]: ")
  if (confirmAnswer === "n" || confirmAnswer === "N") {
    info("Aborted.")
    return
  }

  // ── 6. Bump versions ─────────────────────────────────────────────────────
  for (const p of toPublish) {
    if (p.newVersion !== p.localVersion) {
      bumpVersion(p.name, p.newVersion)
      info(`Bumped ${p.name} to ${p.newVersion}`)
    }
  }

  // ── 7. Build all packages ─────────────────────────────────────────────────
  log("\nBuilding all packages...\n")
  const { publishable, buildFailed, swappedDeps } = buildPackages(toPublish)

  if (publishable.length === 0) {
    const { fail } = require("../shared/logger")
    fail("All builds failed. Nothing to publish.")
    restoreAllDeps(swappedDeps)
    return
  }

  // ── 8. Publish to npm ─────────────────────────────────────────────────────
  // Verify npm auth right before the publish step so the user isn't blocked
  // on login during scan/prompt/build (which don't need npm credentials).
  if (doPublish) {
    if (!(await verifyNpmAuth())) {
      restoreAllDeps(swappedDeps)
      return
    }
  }

  const { published, failed } = await releasePackages(publishable, doPublish)
  const allFailed = [...buildFailed, ...failed]

  // ── 9. Finalize — restore deps, commit, tag, push, summarize ─────────────
  restoreAllDeps(swappedDeps)
  console.log("")
  commitAndTag(published)
  printSummary(published, allFailed, doPublish)
}

module.exports = {
  publish,
  ALL_PACKAGES,
  PUBLISH_TIERS,
  buildReverseDependencyMap,
  resolveAffected,
}