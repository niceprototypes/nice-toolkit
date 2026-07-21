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
const { spawn } = require('child_process');
const { runTasks } = require('../shared/tasks');

/**
 * Run `npm run build` in `dir` as an async child, capturing combined output so
 * the heart spinner (which owns the line) isn't clobbered by rollup's logs.
 * Resolves with the exit code and the captured output (shown only on failure).
 *
 * @param {string} dir - Package directory
 * @param {string[]} extra - Extra args appended after `npm run build --`
 * @returns {Promise<{ code: number, output: string }>}
 */
function spawnBuild(dir, extra) {
  return new Promise((resolve) => {
    const args = ['run', 'build', ...(extra.length ? ['--', ...extra] : [])];
    const child = spawn('npm', args, { cwd: dir });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ code: code == null ? 1 : code, output }));
    child.on('error', (err) => resolve({ code: 1, output: String((err && err.message) || err) }));
  });
}
const { readJSON, pathExists } = require('../shared/fs-utils');
const { getAllPackages } = require('../shared/registry/query');
const { readRegistry } = require('../shared/registry/read');
const { resolveAffected } = require('../publishing/graph');
const os = require('os');
const { info, cyan } = require('../shared/logger');

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
async function buildPackages(packages, { dryRun = false, capture = false, extraArgs = {} } = {}) {
  // Per-package captured build output (retained for the reset log / shown on fail).
  /** @type {Object<string,string>} */
  const output = {};

  // Each package becomes a typed task; the shared runner owns the spinner,
  // glyph lines, failure output, and summary tally (see shared/tasks). A skip
  // or dry-run resolves synchronously, so the runner renders it with no spinner
  // — preserving byte-parity with the old hand-rolled loop.
  const tasks = packages.map((entry) => {
    const name = entry.name;
    const extra = extraArgs[name] || [];
    return {
      label: name,
      activeLabel: `Building ${name}${extra.length ? ` ${extra.join(' ')}` : ''}`,
      /** @returns {import('../shared/tasks/status').Outcome | Promise<import('../shared/tasks/status').Outcome>} */
      run() {
        const dir = resolvePkgDir(name);
        if (!pathExists(dir)) return { kind: 'skipped', detail: 'directory not found' };

        let pkg;
        try {
          pkg = readJSON(path.join(dir, 'package.json'), { useCache: false });
        } catch (e) {
          return { kind: 'failed', detail: 'cannot read package.json' };
        }

        if (!pkg.scripts || !pkg.scripts.build) return { kind: 'skipped', detail: 'no build script' };
        if (dryRun) return { kind: 'done', detail: 'would build' };

        return spawnBuild(dir, extra).then((res) => {
          const combined = res.output.trim();
          if (res.code === 0) {
            if (capture) output[name] = combined;
            return { kind: 'done' };
          }
          // Retain for the reset log; the runner prints `output` beneath the fail line.
          output[name] = combined;
          return { kind: 'failed', detail: 'build failed', output: combined };
        });
      },
    };
  });

  const report = await runTasks(tasks, { verb: dryRun ? 'would build' : 'built' });
  return { built: report.done, skipped: report.skipped, failed: report.failed, output };
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
async function buildAllPackages({ dryRun = false, capture = false } = {}) {
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
async function buildAffected(rootNames, { dryRun = false, convert = false, convertPath, capture = false } = {}) {
  const { changed, dependents } = resolveAffected(rootNames);
  const affected = new Set([...changed, ...dependents]);
  // Preserve tier order: filter the flat tier-ordered list, don't iterate the set.
  const entries = getAllPackages().filter((entry) => affected.has(entry.name));
  if (entries.length === 0) {
    info(`build: no registered packages matched ${cyan(rootNames.join(', '))}`);
    return { built: [], skipped: [], failed: [] };
  }
  info(`build: ${cyan(entries.map((entry) => entry.name).join(' → '))}`);
  // Conversion is a nice-icons concern — pass --convert only to its build, and
  // only when nice-icons is actually in the affected set.
  const extraArgs = convert && affected.has('nice-icons')
    ? { 'nice-icons': ['--convert', ...(convertPath ? [convertPath] : [])] }
    : {};
  return buildPackages(entries, { dryRun, capture, extraArgs });
}

/**
 * Rebuilds nice-icons and every registered package that transitively depends on
 * it, in tier order — the targeted build for an SVG/icon-asset change. Thin
 * wrapper over {@link buildAffected} rooted at nice-icons (the `icons` group).
 *
 * @param {object} [options] - forwarded to buildAffected
 * @returns {{ built: string[], skipped: string[], failed: string[] }}
 */
async function buildIcons(options = {}) {
  return buildAffected(['nice-icons'], options);
}

module.exports = {
  buildPackages,
  buildAllPackages,
  buildAffected,
  buildIcons,
};
