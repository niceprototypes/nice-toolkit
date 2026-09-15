/**
 * @fileoverview Preflight + execution for `nicely --build-icons`.
 *
 * `--build-icons` rebuilds nice-icons + its dependents' dist via one-shot
 * `npm run build`. A concurrently-running `nicely --dev --watch` runs `rollup -c -w`
 * over those SAME packages into the SAME dist, and every rollup build wipes
 * dist/ first (`clean: true`), so the two race — transient
 * `Could not resolve entry module "dist/types/index.d.ts"` errors and consumer
 * reloads against half-written dist. So this handler just stops any running
 * dev/watch first — the same reflex as the `--vite`/refreshVite step killing
 * dev-server ports — rather than prompting. Pass `--no-kill` to opt out.
 *
 * @module cli/handle-build-icons
 */

const os = require('os');
const { warn, success } = require('../shared/logger');
const { readRegistry } = require('../shared/registry/read');
const { buildAffected } = require('../linking/dist-builder');
const { refreshVite } = require('../linking/cache-cleaner');
const { findDevWatchProcesses, terminateDevWatchers } = require('../linking/dev-watch-killer');

/**
 * Run a scoped build (roots + their dependents, tier order), then refresh Vite
 * deps so the rebuilt dist is picked up.
 *
 * @param {object} options - dryRun / noKill / convert / convertPath / convertTargets
 * @param {string[]} roots - root package names to build (with dependents)
 * @returns {number} Process exit code (0 ok, 1 if any package build failed)
 */
async function runScopedBuild(options, roots) {
  // The icon names to regenerate before building (from `--convert a b c`, or the
  // matched set for an icon-name target). Empty converts every `.source` `.ai`.
  const convertTargets = options.convertTargets || [];
  const result = await buildAffected(roots, { dryRun: options.dryRun, convert: options.convert, convertTargets });
  // A rebuilt dist is inert until Vite re-bundles it — refresh the deps cache +
  // bounce dev servers so the new build actually renders.
  if (result.failed.length === 0) {
    const registry = readRegistry();
    const baseDir = registry.basePath.replace('~', os.homedir());
    refreshVite(baseDir, { dryRun: options.dryRun, killPorts: !options.noKill });
  }
  return result.failed.length > 0 ? 1 : 0;
}

/**
 * Handle a scoped `nicely build <targets>` (e.g. `build icons`). Auto-stops any
 * running `nicely develop` first (its rollup watchers rebuild the same dist and
 * would race) — unless `--no-kill` — then builds the roots + dependents and
 * refreshes Vite.
 *
 * @param {object} options - Parsed modifier options
 * @param {string[]} roots - Root package names (default: the icons group)
 * @returns {Promise<number>} Exit code
 */
async function handleBuild(options, roots = ['nice-icons']) {
  const running = findDevWatchProcesses();

  if (running.length > 0) {
    if (options.noKill) {
      // Explicit opt-out — build anyway and let the caller own the race.
      warn(`${running.length} nicely develop running and --no-kill set — building anyway; expect a dist race.`);
    } else {
      // Auto-stop the dev watcher(s). terminateDevWatchers logs each process it
      // signals and no-ops (reports only) under dryRun.
      terminateDevWatchers({ dryRun: options.dryRun });
    }
  }

  const code = await runScopedBuild(options, roots);
  // Remind the user to restart the watcher we stopped, once the build is clean.
  if (code === 0 && running.length > 0 && !options.noKill && !options.dryRun) {
    success('Built. Restart `nicely develop` to resume hot-reloading.');
  }
  return code;
}

/** Back-compat: the icons-scoped build is just `handleBuild` rooted at nice-icons. */
const handleBuildIcons = (options) => handleBuild(options, ['nice-icons']);

module.exports = { handleBuild, handleBuildIcons };
