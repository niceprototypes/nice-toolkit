/**
 * @fileoverview CLI entry point for nice-toolkit
 *
 * Routes command-line flags to the appropriate operation:
 *
 *   --create     Scaffold a new Nice ecosystem package
 *   --publish    Publish packages to npm with dependency cascade
 *   --unlink     Restore packages to their original npm versions
 *   --dev        Run dev scripts in all linked packages concurrently
 *   --watch      Watch linked package dist folders for changes
 *   --dedupe     Remove duplicate singletons from linked packages (recursive, or scoped to one path)
 *   --clean      Kill dev-server ports + wipe consumer caches
 *   (default)    Link a package via file: protocol
 *
 * @module nice-toolkit
 */

const path = require('path');
const os = require('os');
const { DEFAULT_CONFLICTING_PACKAGES, PEER_ENFORCE } = require('./shared/config');
const { log, info, success, warn, fail, cyan, gray } = require('./shared/logger');
const { showUsage, parseArgs } = require('./args');
const { detectPM, isWorkspaceRoot } = require('./linking/pm');
const { pathExists, readJSON } = require('./shared/fs-utils');
const { findAllLinkedPackages, readPkgName, validatePackageDir } = require('./linking/discovery');
const { ensurePeerDeps } = require('./linking/peer-deps');
const { removeConflictsInDir, dedupeLinkedPackages } = require('./linking/cleaner');
const { cleanAllCaches } = require('./linking/cache-cleaner');
const { buildAllPackages } = require('./linking/dist-builder');
const { readRegistry } = require('./shared/registry/read');
const { linkPackage, unlinkPackages } = require('./linking/linker');
const { startWatching, TRIGGER_FILE_NAME } = require('./linking/watcher');
const { startDevRunner } = require('./linking/dev-runner');
const { publish } = require('./publishing');
const { create } = require('./creator');
const { appendBumpIntent, bumpFileRelativePath } = require('./shared/bump');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detects Create React App by checking for react-scripts in dependencies.
 * Displays NODE_OPTIONS advice if found.
 *
 * @param {string} projectDir - Project root directory
 * @returns {boolean} True if CRA was detected
 * @private
 */
function showCRAAdvice(projectDir) {
  try {
    const pkg = readJSON(path.join(projectDir, 'package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['react-scripts']) {
      info('CRA detected. If module resolution errors occur, try:');
      info('  export NODE_OPTIONS=--preserve-symlinks  (bash/zsh)');
      info('  setx NODE_OPTIONS "--preserve-symlinks"  (Windows)');
      return true;
    }
  } catch {
    // package.json missing or unreadable — not a CRA project
  }
  return false;
}

/**
 * Displays recommended next steps after a successful link operation.
 * Adapts suggestions based on available scripts and project type.
 *
 * @param {string} resolvedPkgPath - Absolute path to the linked package
 * @param {boolean} isCRA - Whether the consuming project uses CRA
 * @private
 */
function showNextSteps(resolvedPkgPath, isCRA) {
  const pkg = readJSON(path.join(resolvedPkgPath, 'package.json'));
  const hasDevScript = pkg.scripts?.dev;
  const hasWatchScript = pkg.scripts?.['build:watch'];
  const pkgName = path.basename(resolvedPkgPath);

  log('\nNext steps:');

  if (hasDevScript || hasWatchScript) {
    const watchCmd = hasDevScript ? 'npm run dev' : 'npm run build:watch';
    log(`Run ${cyan(watchCmd)} in ${gray(pkgName)} for live rebuilding`);
    log(`Edit files in ${gray(pkgName)} → auto-rebuild → changes appear in your app`);
  } else {
    log(`Run ${cyan('npm run build')} in ${gray(pkgName)} after making changes`);
  }

  if (isCRA) {
    log(`Restart your dev server with: ${cyan('NODE_OPTIONS=--preserve-symlinks npm start')}`);
  } else {
    log('Restart your dev server if needed');
  }

  log(`To unlink: run ${cyan('npx nice-toolkit --unlink')}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Command Handlers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Starts dev runner and/or watcher processes.
 * Sets up SIGINT/SIGTERM handlers for graceful shutdown.
 * This function does not return — it keeps the process alive.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleDevWatch(projectDir, options) {
  let devController = null;
  let watchController = null;

  if (options.dev) {
    devController = startDevRunner(projectDir, { verbose: true });
  }

  if (options.watch) {
    watchController = startWatching(projectDir, {
      watchDir: options.watchDir,
      verbose: true,
    });
  }

  // Graceful shutdown on Ctrl+C or kill signal
  const shutdown = () => {
    if (watchController) watchController.stop();
    if (devController) devController.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Dedupes singletons in a single linked package (scoped form of --dedupe).
 *
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleScopedDedupe(options) {
  const validation = validatePackageDir(options.pkgPath);
  if (!validation.valid) {
    fail(validation.error);
    process.exit(1);
  }

  const resolvedPath = path.resolve(options.pkgPath);

  if (!options.skipPeerCheck) {
    ensurePeerDeps(resolvedPath, PEER_ENFORCE, { dryRun: options.dryRun });
  }

  removeConflictsInDir(resolvedPath, options.packagesToRemove, {
    dryRun: options.dryRun,
  });

  success('Dedupe completed');
}

/**
 * Links a package via file: protocol and cleans conflicts.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleLink(projectDir, options) {
  if (!options.pkgPath) {
    fail('Please provide a path to the package you want to link');
    showUsage();
    process.exit(1);
  }

  const validation = validatePackageDir(options.pkgPath);
  if (!validation.valid) {
    fail(validation.error);
    process.exit(1);
  }

  const resolvedPath = path.resolve(options.pkgPath);

  if (isWorkspaceRoot(projectDir) && !options.forcedPM) {
    warn('Workspaces detected. Consider using "workspace:" or local file deps instead of linking.');
  }

  if (!options.skipPeerCheck) {
    ensurePeerDeps(resolvedPath, PEER_ENFORCE, { dryRun: options.dryRun });
  }

  // Clean → link → detect CRA → clean again
  // The second clean pass is needed because npm install during linking
  // may reinstall the same conflicting singletons we just removed
  removeConflictsInDir(resolvedPath, options.packagesToRemove, { dryRun: options.dryRun });

  const pkgName = readPkgName(resolvedPath);
  linkPackage(options.pm, resolvedPath, pkgName, { dryRun: options.dryRun });

  const isCRA = showCRAAdvice(projectDir);

  removeConflictsInDir(resolvedPath, options.packagesToRemove, { dryRun: options.dryRun });

  success(`Successfully linked ${cyan(pkgName)}!`);
  showNextSteps(resolvedPath, isCRA);
}

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

  if (options.create) {
    create({ name: options.create, type: options.createType, dryRun: options.dryRun });
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