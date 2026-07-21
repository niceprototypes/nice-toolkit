/**
 * @fileoverview CLI entry point for nice-toolkit (`nicely`)
 *
 * Grammar: `nicely <verb> [targets…] [--modifiers]`.
 *
 *   nicely link ../my-lib       Link a package via file: protocol
 *   nicely unlink               Restore packages to their original npm versions
 *   nicely publish [targets]    Publish to npm with the dependency cascade
 *   nicely build [targets]      Rebuild dists in tier order (all / a group / names)
 *   nicely dedupe [path]        Remove duplicate singletons from linked packages
 *   nicely clean [--vite]       Kill dev servers + wipe consumer caches
 *   nicely reset                build → dedupe → clean (post-refactor recovery)
 *   nicely develop              Rebuild + reload loop across linked packages
 *   nicely bump <level> <msg>   Record a bump-intent entry
 *
 * Targets for the list verbs (publish / build) are uniform: `all`, a group
 * (`icons`), or space-separated package names. See args/select.js.
 *
 * @module nice-toolkit
 */

const os = require('os');
const { DEFAULT_CONFLICTING_PACKAGES, PEER_ENFORCE } = require('./shared/config');
const { info, success, fail, cyan, gray } = require('./shared/logger');
const { showUsage } = require('./args');
const { parseCommand, parseModifiers, FLAGS_WITH_VALUES } = require('./args/command');
const { findPositionalArgs } = require('./args/parsers');
const { resolveTargets } = require('./args/select');
const { detectPM } = require('./linking/pm');
const { findAllLinkedPackages } = require('./linking/discovery');
const { ensurePeerDeps } = require('./linking/peer-deps');
const { removeConflictsInDir, dedupeLinkedPackages } = require('./linking/cleaner');
const { cleanAllCaches } = require('./linking/cache-cleaner');
const { buildAllPackages, buildAffected } = require('./linking/dist-builder');
const { terminateDevWatchers } = require('./linking/dev-watch-killer');
const { readRegistry } = require('./shared/registry/read');
const { getPackageNames } = require('./shared/registry/query');
const { linkPackage, unlinkPackages } = require('./linking/linker');
const { startWatching, TRIGGER_FILE_NAME } = require('./linking/watcher');
const { startDevRunner } = require('./linking/dev-runner');
const { publish } = require('./publishing');
const { appendBumpIntent, bumpFileRelativePath } = require('./shared/bump');
const { handleDevWatch } = require('./cli/handle-dev-watch');
const { handleScopedDedupe } = require('./cli/handle-scoped-dedupe');
const { handleLink } = require('./cli/handle-link');
const { handleBuild } = require('./cli/handle-build-icons');
const { writeResetLog } = require('./cli/reset-log');

/** Verbs that touch node_modules and therefore report the package manager. */
const PM_VERBS = new Set(['link', 'unlink', 'dedupe', 'reset', 'develop']);

/** The workspace base dir (`registry.basePath` with `~` expanded). */
function baseDir() {
  return readRegistry().basePath.replace('~', os.homedir());
}

// ── Per-verb runners ──────────────────────────────────────────────────────────

function runLink(projectDir, targets, options) {
  if (targets.length > 1) {
    fail(`link takes a single package path (got ${targets.length}). Try: ${cyan('nicely link <path>')}`);
    process.exit(1);
  }
  handleLink(projectDir, { ...options, pkgPath: targets[0] });
}

async function runUnlink(options) {
  await unlinkPackages(options.pm, { dryRun: options.dryRun });
  process.exit(0);
}

function runPublish(targets, options) {
  const sel = resolveTargets(targets);
  let packages;
  if (sel.all) packages = getPackageNames();
  else if (options.changed || sel.empty) packages = undefined; // bare / --changed = changed set
  else packages = sel.roots;

  publish({ packages, doPublish: !options.noNpm, dryRun: options.dryRun })
    .then(() => process.exit(0))
    .catch((e) => { fail(e.message); process.exit(1); });
}

function runBuild(targets, options) {
  const sel = resolveTargets(targets);
  // `build` / `build all` → full sweep (raw, matches the old --build-all).
  if (sel.all || sel.empty) {
    buildAllPackages({ dryRun: options.dryRun })
      .then((result) => process.exit(result.failed.length > 0 ? 1 : 0))
      .catch((e) => { fail(e.message); process.exit(1); });
    return;
  }
  // `build icons` / `build <names>` → scoped, guarded build (stop dev, refresh Vite).
  handleBuild(options, sel.roots)
    .then((code) => process.exit(code))
    .catch((e) => { fail(e.message); process.exit(1); });
}

async function runDedupe(projectDir, targets, options) {
  const sel = resolveTargets(targets);
  if (!sel.all && sel.roots.length) {
    // A single positional scopes dedupe to one linked package path.
    if (sel.roots.length > 1) {
      fail(`dedupe scopes to a single path, or all packages. Try: ${cyan('nicely dedupe [path]')}`);
      process.exit(1);
    }
    handleScopedDedupe({ ...options, pkgPath: sel.roots[0] });
  } else {
    await dedupeLinkedPackages(projectDir, options.packagesToRemove, {
      dryRun: options.dryRun,
      skipPeerCheck: options.skipPeerCheck,
      peerEnforce: PEER_ENFORCE,
    });
  }
  process.exit(0);
}

function runClean(options) {
  // Core clean is framework-agnostic; tool caches (vite, …) opt in per flag.
  const tools = [];
  if (options.vite) tools.push('vite');
  cleanAllCaches(baseDir(), { dryRun: options.dryRun, killPorts: !options.noKill, tools });
  process.exit(0);
}

async function runReset(projectDir, options) {
  try {
    info('reset: build → dedupe → clean');
    // Stop any running `nicely develop` first — its rollup watchers write the same
    // dist files the rebuild does, and dedupe/clean mutate node_modules + caches
    // under it.
    const stopped = terminateDevWatchers({ dryRun: options.dryRun });
    if (stopped > 0) {
      info(`Stopped ${stopped} running dev process${stopped === 1 ? '' : 'es'} before reset`);
    }
    const buildResult = await buildAllPackages({ dryRun: options.dryRun, capture: options.log });
    await dedupeLinkedPackages(projectDir, options.packagesToRemove, {
      dryRun: options.dryRun,
      skipPeerCheck: options.skipPeerCheck,
      peerEnforce: PEER_ENFORCE,
    });
    const dir = baseDir();
    cleanAllCaches(dir, { dryRun: options.dryRun, killPorts: !options.noKill });
    if (options.log) {
      const logFile = writeResetLog(dir, buildResult);
      info(`Reset log written to ${cyan(logFile)}`);
    }
    process.exit(buildResult.failed.length > 0 ? 1 : 0);
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }
}

function runDev(projectDir, options) {
  // One verb, full loop by default. `--no-reload` = rebuild only (old --dev);
  // `--reload-only` = trigger only, for external rebuilders (old --watch).
  handleDevWatch(projectDir, {
    ...options,
    dev: !options.reloadOnly,
    watch: !options.noReload,
    watchDir: options.watchDir,
  });
}

function runBump(projectDir, targets) {
  const [level, ...rest] = targets;
  const message = rest.join(' ');
  if (!level || !message) {
    fail('bump needs a level and a message, e.g. nicely bump minor "Add spacing prop"');
    process.exit(1);
  }
  try {
    appendBumpIntent(projectDir, level, message);
    success(`Recorded ${cyan(level)} bump: ${gray(message)}`);
    info(`Commit ${cyan(bumpFileRelativePath())} alongside your change.`);
    process.exit(0);
  } catch (e) {
    fail(e.message);
    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * CLI entry point. Classifies the command, parses modifiers + targets, and
 * dispatches to the matching runner.
 *
 * @returns {void}
 */
function main() {
  const projectDir = process.cwd();
  const cmd = parseCommand(process.argv.slice(2));

  if (cmd.verb === 'help') {
    showUsage();
    process.exit(0);
  }
  if (cmd.verb === '__legacy__') {
    fail(`nicely no longer uses flag-commands (${cmd.token}).`);
    if (cmd.suggestion) info(`Use: ${cyan('nicely ' + cmd.suggestion)}`);
    else info(`Run ${cyan('nicely help')} for the command list.`);
    process.exit(1);
  }
  if (cmd.verb === '__unknown__') {
    fail(`Unknown command "${cmd.token}".${cmd.suggestion ? ` Did you mean ${cyan('nicely ' + cmd.suggestion)}?` : ''}`);
    info(`Run ${cyan('nicely help')} for the command list.`);
    process.exit(1);
  }

  const detectedPM = detectPM(projectDir);
  const options = parseModifiers(cmd.rest, { conflictingPackages: DEFAULT_CONFLICTING_PACKAGES, pm: detectedPM });
  const targets = findPositionalArgs(cmd.rest, FLAGS_WITH_VALUES);

  if (PM_VERBS.has(cmd.verb)) {
    info(options.forcedPM ? `Using forced package manager: ${cyan(options.pm)}` : `Detected package manager: ${cyan(options.pm)}`);
  }

  switch (cmd.verb) {
    case 'link': return runLink(projectDir, targets, options);
    case 'unlink': return runUnlink(options);
    case 'publish': return runPublish(targets, options);
    case 'build': return runBuild(targets, options);
    case 'dedupe': return runDedupe(projectDir, targets, options);
    case 'clean': return runClean(options);
    case 'reset': return runReset(projectDir, options);
    case 'develop': return runDev(projectDir, options);
    case 'bump': return runBump(projectDir, targets);
    default:
      // Unreachable — parseCommand only returns known verbs here.
      showUsage();
      process.exit(1);
  }
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
  buildAllPackages,
  buildAffected,

  // Config
  DEFAULT_CONFLICTING_PACKAGES,
  PEER_ENFORCE,
  TRIGGER_FILE_NAME,
};
