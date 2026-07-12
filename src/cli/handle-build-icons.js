/**
 * @fileoverview Preflight + execution for `ntk --build-icons`.
 *
 * `--build-icons` rebuilds nice-icons + its dependents' dist via one-shot
 * `npm run build`. A concurrently-running `ntk --dev --watch` runs `rollup -c -w`
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
const { buildIcons } = require('../linking/dist-builder');
const { refreshVite } = require('../linking/cache-cleaner');
const { findDevWatchProcesses, terminateDevWatchers } = require('../linking/dev-watch-killer');

/**
 * Run the icon build, then refresh Vite deps so the rebuilt dist is picked up.
 *
 * @param {{ dryRun?: boolean, noKill?: boolean, convert?: boolean, convertPath?: string }} options
 * @returns {number} Process exit code (0 ok, 1 if any package build failed)
 */
function runBuildIcons(options) {
  const result = buildIcons({ dryRun: options.dryRun, convert: options.convert, convertPath: options.convertPath });
  // A rebuilt dist is inert until Vite re-bundles it — refresh the deps cache +
  // bounce dev servers so the new icons actually render.
  if (result.failed.length === 0) {
    const registry = readRegistry();
    const baseDir = registry.basePath.replace('~', os.homedir());
    refreshVite(baseDir, { dryRun: options.dryRun, killPorts: !options.noKill });
  }
  return result.failed.length > 0 ? 1 : 0;
}

/**
 * Handle `ntk --build-icons`. Auto-stops any running `ntk --dev`/`--watch`
 * first (they rebuild the same dist and would race), the same way refreshVite
 * kills dev-server ports — unless `--no-kill` is set — then runs the build.
 *
 * @param {object} options - Parsed CLI options
 * @returns {Promise<number>} Exit code
 */
async function handleBuildIcons(options) {
  const running = findDevWatchProcesses();

  if (running.length > 0) {
    if (options.noKill) {
      // Explicit opt-out — build anyway and let the caller own the race.
      warn(`${running.length} ntk --dev/--watch running and --no-kill set — building anyway; expect a dist race.`);
    } else {
      // Auto-stop the dev watcher(s). terminateDevWatchers logs each process it
      // signals and no-ops (reports only) under dryRun.
      terminateDevWatchers({ dryRun: options.dryRun });
    }
  }

  const code = runBuildIcons(options);
  // Remind the user to restart the watcher we stopped, once the build is clean.
  if (code === 0 && running.length > 0 && !options.noKill && !options.dryRun) {
    success('Icons rebuilt. Restart `ntk --dev --watch` to resume hot-reloading.');
  }
  return code;
}

module.exports = { handleBuildIcons };
