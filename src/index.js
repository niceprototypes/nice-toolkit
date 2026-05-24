/**
 * @fileoverview CLI entry point for nice-toolkit
 *
 * Routes command-line flags to the appropriate operation:
 *
 *   --publish    Publish packages to npm with dependency cascade
 *   --unlink     Restore packages to their original npm versions
 *   --dev        Run dev scripts in all linked packages concurrently
 *   --watch      Watch linked package dist folders for changes
 *   --dedupe     Remove duplicate singletons from linked packages (recursive, or scoped to one path)
 *   --clean      Kill dev-server ports + wipe consumer caches
 *   --reset      Chain --build-all → --dedupe → --clean (post-foundation-refactor recovery)
 *   (default)    Link a package via file: protocol
 *
 * @module nice-toolkit
 */

const os = require('os');
const { DEFAULT_CONFLICTING_PACKAGES, PEER_ENFORCE } = require('./shared/config');
const { info, success, fail, cyan, gray } = require('./shared/logger');
const { showUsage, parseArgs } = require('./args');
const { detectPM } = require('./linking/pm');
const { findAllLinkedPackages } = require('./linking/discovery');
const { ensurePeerDeps } = require('./linking/peer-deps');
const { removeConflictsInDir, dedupeLinkedPackages } = require('./linking/cleaner');
const { cleanAllCaches } = require('./linking/cache-cleaner');
const { buildAllPackages } = require('./linking/dist-builder');
const { readRegistry } = require('./shared/registry/read');
const { linkPackage, unlinkPackages } = require('./linking/linker');
const { startWatching, TRIGGER_FILE_NAME } = require('./linking/watcher');
const { startDevRunner } = require('./linking/dev-runner');
const { publish } = require('./publishing');
const { appendBumpIntent, bumpFileRelativePath } = require('./shared/bump');
const { handleDevWatch } = require('./cli/handle-dev-watch');
const { handleScopedDedupe } = require('./cli/handle-scoped-dedupe');
const { handleLink } = require('./cli/handle-link');

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

/**
 * CLI entry point. Parses arguments and routes to the appropriate handler.
 *
 * @returns {void}
 */
function main() {
  const projectDir = process.cwd();

  // Detect package manager from lockfile (pnpm > yarn > npm)
  const detectedPM = detectPM(projectDir);

  // Parse CLI arguments into a structured options object
  const options = parseArgs(process.argv.slice(2), {
    conflictingPackages: DEFAULT_CONFLICTING_PACKAGES,
    pm: detectedPM,
  });

  if (options.showHelp) {
    showUsage();
    process.exit(0);
  }

  if (options.forcedPM) {
    info(`Using forced package manager: ${cyan(options.pm)}`);
  } else {
    info(`Detected package manager: ${cyan(options.pm)}`);
  }

  // ── Route to handler ──────────────────────────────────────────────────────
  // Mutually exclusive — each branch exits or returns after completion.

  if (options.unlink) {
    unlinkPackages(options.pm, { dryRun: options.dryRun });
    process.exit(0);
  }

  if (options.bumpLevel) {
    if (!options.bumpMessage) {
      fail('--bump <level> requires a commit message, e.g. ntk --bump major "Rename breakpoint identifiers"');
      process.exit(1);
    }
    try {
      appendBumpIntent(projectDir, options.bumpLevel, options.bumpMessage);
      success(`Recorded ${cyan(options.bumpLevel)} bump: ${gray(options.bumpMessage)}`);
      info(`Commit ${cyan(bumpFileRelativePath())} alongside your change.`);
      process.exit(0);
    } catch (e) {
      fail(e.message);
      process.exit(1);
    }
  }

  // Async — uses return instead of process.exit to allow promise chain
  if (options.publish || options.dryPublish) {
    // publishPackages may contain a flag value (e.g. "--dry-run") when
    // --publish is used without package names — filter those out
    const rawPackages = options.publishPackages
    const packages = rawPackages && !rawPackages.startsWith("--")
      ? rawPackages.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    publish({
      packages,
      doPublish: !options.noNpm,
      dryRun: options.dryPublish || options.dryRun,
    })
      .then(() => process.exit(0))
      .catch((e) => {
        fail(e.message);
        process.exit(1);
      });
    return;
  }

  // Long-running — keeps the process alive for Ctrl+C shutdown
  if (options.dev || options.watch) {
    handleDevWatch(projectDir, options);
    return;
  }

  if (options.dedupe) {
    if (options.pkgPath) {
      handleScopedDedupe(options);
    } else {
      dedupeLinkedPackages(projectDir, options.packagesToRemove, {
        dryRun: options.dryRun,
        skipPeerCheck: options.skipPeerCheck,
        peerEnforce: PEER_ENFORCE,
      });
    }
    process.exit(0);
  }

  if (options.clean) {
    const registry = readRegistry();
    const baseDir = registry.basePath.replace('~', os.homedir());
    cleanAllCaches(baseDir, { dryRun: options.dryRun, killPorts: !options.noKill });
    process.exit(0);
  }

  if (options.buildAll) {
    const result = buildAllPackages({ dryRun: options.dryRun });
    process.exit(result.failed.length > 0 ? 1 : 0);
  }

  if (options.reset) {
    info('--reset: --build-all → --dedupe → --clean');
    const buildResult = buildAllPackages({ dryRun: options.dryRun });
    dedupeLinkedPackages(projectDir, options.packagesToRemove, {
      dryRun: options.dryRun,
      skipPeerCheck: options.skipPeerCheck,
      peerEnforce: PEER_ENFORCE,
    });
    const registry = readRegistry();
    const baseDir = registry.basePath.replace('~', os.homedir());
    cleanAllCaches(baseDir, { dryRun: options.dryRun, killPorts: !options.noKill });
    process.exit(buildResult.failed.length > 0 ? 1 : 0);
  }

  handleLink(projectDir, options);
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  main,

  // Re-exports for programmatic use
  detectPM,
  findAllLinkedPackages,
  dedupeLinkedPackages,
  removeConflictsInDir,
  ensurePeerDeps,
  linkPackage,
  unlinkPackages,
  startWatching,
  startDevRunner,

  // Config
  DEFAULT_CONFLICTING_PACKAGES,
  PEER_ENFORCE,
  TRIGGER_FILE_NAME,
};
