/**
 * @fileoverview Tier-ordered dist rebuild across every registered nice-* package
 *
 * The `prepare` hook previously rebuilt every linked package transitively on
 * any consumer's `npm install`. That cascade was removed (see
 * manifest/.nice/reports/npm-install-breaks-consumers.md). This module
 * provides the explicit replacement: walk the registry in tier order and run
 * each package's `npm run build` once.
 *
 * Use after `--dedupe`, after a foundation-package refactor, or on a fresh
 * clone of the workspace.
 *
 * @module dist-builder
 */

const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { readJSON, pathExists } = require('../shared/fs-utils');
const { getAllPackages } = require('../shared/registry/query');
const { readRegistry } = require('../shared/registry/read');
const { resolveAffected } = require('../publishing/graph');
const os = require('os');
const { log, info, success, fail, warn, cyan, gray, green, red } = require('../shared/logger');

/**
 * Resolves the absolute directory for a registered package.
 *
 * @param {string} name - Package name (e.g. "nice-react-button")
 * @returns {string}
 */
function resolvePkgDir(name) {
  const baseDir = readRegistry().basePath.replace('~', os.homedir());
  return path.join(baseDir, name.replace(/^nice-/, ''));
}

/**
 * Runs `npm run build` in each given package entry, in the order provided.
 *
 * Packages without a build script are skipped (e.g. CLI packages with no
 * compile step). Failures are collected and surfaced at the end — the loop
 * does not halt on a single package's failure so the user sees the full set
 * of broken builds in one pass. Callers pass entries already sorted into the
 * correct build order (tier order), since a subtree must build its foundation
 * before its dependents.
 *
 * @param {object[]} packages - Registry entries to build ({ name, ... })
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without running builds
 * @param {boolean} [options.capture=false] - Capture each build's combined
 *   stdout/stderr (still echoed live) so callers can persist failure output to
 *   a log. Adds an `output` map (name → captured text) to the return value.
 * @param {Object<string,string[]>} [options.extraArgs={}] - Per-package extra
 *   CLI args appended to its build as `npm run build -- <args>` (keyed by
 *   package name). Used e.g. to pass `--convert` to nice-icons only.
 * @returns {{ built: string[], skipped: string[], failed: string[], output: Object<string,string> }}
 */
function buildPackages(packages, { dryRun = false, capture = false, extraArgs = {} } = {}) {
  const built = [];
  const skipped = [];
  const failed = [];
  // Per-package annotation (skip/fail reason) shown in the final list.
  const reasons = {};
  // Per-package captured build output (only populated when `capture` is set).
  const output = {};

  for (const entry of packages) {
    const name = entry.name;
    const dir = resolvePkgDir(name);

    if (!pathExists(dir)) {
      warn(`${name}: directory not found at ${gray(dir)} — skipping`);
      skipped.push(name);
      reasons[name] = 'directory not found';
      continue;
    }

    let pkg;
    try {
      pkg = readJSON(path.join(dir, 'package.json'), { useCache: false });
    } catch (e) {
      fail(`${name}: cannot read package.json — ${e.message}`);
      failed.push(name);
      reasons[name] = 'cannot read package.json';
      continue;
    }

    if (!pkg.scripts || !pkg.scripts.build) {
      log(`${gray('—')} ${gray(name)} (no build script)`);
      skipped.push(name);
      reasons[name] = 'no build script';
      continue;
    }

    if (dryRun) {
      info(`would build ${cyan(name)}`);
      built.push(name);
      continue;
    }

    const extra = extraArgs[name] || [];
    info(`Building ${cyan(name)}${extra.length ? ` ${gray(extra.join(' '))}` : ''}…`);
    if (capture) {
      // Capture combined output so the reset log can include the error, while
      // still echoing it live (buffered per package, printed on completion).
      const res = spawnSync('npm', ['run', 'build', ...(extra.length ? ['--', ...extra] : [])], { cwd: dir, encoding: 'utf8' });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      if (res.status === 0) {
        built.push(name);
      } else {
        fail(`${name}: build failed`);
        failed.push(name);
        reasons[name] = 'build failed';
        output[name] = `${res.stdout || ''}${res.stderr || ''}`.trim();
      }
    } else {
      try {
        execSync(`npm run build${extra.length ? ` -- ${extra.join(' ')}` : ''}`, { cwd: dir, stdio: 'inherit' });
        built.push(name);
      } catch (e) {
        fail(`${name}: build failed`);
        failed.push(name);
        reasons[name] = 'build failed';
      }
    }
  }

  const verb = dryRun ? 'would build' : 'built';
  const summary = `${verb} ${built.length}, skipped ${skipped.length}, failed ${failed.length}`;
  if (failed.length > 0) {
    fail(summary);
  } else {
    success(summary);
  }

  // Per-package list, grouped built → skipped → failed. Names are padded to a
  // common width so the gray skip/fail reasons line up in a column.
  const allNames = [...built, ...skipped, ...failed];
  const pad = allNames.reduce((max, n) => Math.max(max, n.length), 0);
  for (const name of built) console.log(`  ${green('✓')} ${name}`);
  for (const name of skipped) console.log(`  ${gray('⊘')} ${name.padEnd(pad)}  ${gray(reasons[name] || '')}`);
  for (const name of failed) console.log(`  ${red('✗')} ${name.padEnd(pad)}  ${gray(reasons[name] || '')}`);

  return { built, skipped, failed, output };
}

/**
 * Walks every registered package in tier order and runs `npm run build`
 * in each one that defines a build script.
 *
 * Use after `--dedupe`, after a foundation-package refactor, or on a fresh
 * clone of the workspace.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without running builds
 * @returns {{ built: string[], skipped: string[], failed: string[] }}
 */
function buildAllPackages({ dryRun = false, capture = false } = {}) {
  return buildPackages(getAllPackages(), { dryRun, capture });
}

/**
 * Rebuilds nice-icons and every registered package that transitively depends
 * on it, in tier order — the targeted build for an SVG/icon-asset change,
 * avoiding a full `--build-all` sweep.
 *
 * The affected set is resolved from the same reverse file:-dependency graph
 * that `--publish` uses (`resolveAffected`), so it stays in sync with the
 * publish cascade. Today that set is nice-icons → nice-react-icon →
 * nice-react-icon-vendor, nice-react-button. Entries are filtered from the
 * flat tier-ordered package list so foundation builds before dependents.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without running builds
 * @param {boolean} [options.convert=false] - Pass `--convert` to nice-icons'
 *   build so it turns new `.source` `.ai` files into SVGs (pdf2svg) first.
 * @param {string} [options.convertPath] - Optional `.source` subpath to scope
 *   the conversion (e.g. "brands/github").
 * @returns {{ built: string[], skipped: string[], failed: string[] }}
 */
function buildIcons({ dryRun = false, convert = false, convertPath } = {}) {
  const { changed, dependents } = resolveAffected(['nice-icons']);
  const affected = new Set([...changed, ...dependents]);
  // Preserve tier order: filter the flat tier-ordered list, don't iterate the set.
  const entries = getAllPackages().filter((entry) => affected.has(entry.name));
  info(`--build-icons: ${cyan(entries.map((entry) => entry.name).join(' → '))}`);
  // Conversion is a nice-icons concern — pass --convert only to its build.
  const extraArgs = convert
    ? { 'nice-icons': ['--convert', ...(convertPath ? [convertPath] : [])] }
    : {};
  return buildPackages(entries, { dryRun, extraArgs });
}

module.exports = {
  buildPackages,
  buildAllPackages,
  buildIcons,
};
