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
const { execSync } = require('child_process');
const { readJSON, pathExists } = require('../shared/fs-utils');
const { getAllPackages } = require('../shared/registry/query');
const { readRegistry } = require('../shared/registry/read');
const os = require('os');
const { log, info, success, fail, warn, cyan, gray } = require('../shared/logger');

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
 * Walks every registered package in tier order and runs `npm run build`
 * in each one that defines a build script.
 *
 * Packages without a build script are skipped (e.g. CLI packages with no
 * compile step). Failures are collected and surfaced at the end — the loop
 * does not halt on a single package's failure so the user sees the full set
 * of broken builds in one pass.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Preview without running builds
 * @returns {{ built: string[], skipped: string[], failed: string[] }}
 */
function buildAllPackages({ dryRun = false } = {}) {
  const packages = getAllPackages();
  const built = [];
  const skipped = [];
  const failed = [];

  for (const entry of packages) {
    const name = entry.name;
    const dir = resolvePkgDir(name);

    if (!pathExists(dir)) {
      warn(`${name}: directory not found at ${gray(dir)} — skipping`);
      skipped.push(name);
      continue;
    }

    let pkg;
    try {
      pkg = readJSON(path.join(dir, 'package.json'), { useCache: false });
    } catch (e) {
      fail(`${name}: cannot read package.json — ${e.message}`);
      failed.push(name);
      continue;
    }

    if (!pkg.scripts || !pkg.scripts.build) {
      log(`${gray('—')} ${gray(name)} (no build script)`);
      skipped.push(name);
      continue;
    }

    if (dryRun) {
      info(`would build ${cyan(name)}`);
      built.push(name);
      continue;
    }

    info(`Building ${cyan(name)}…`);
    try {
      execSync('npm run build', { cwd: dir, stdio: 'inherit' });
      built.push(name);
    } catch (e) {
      fail(`${name}: build failed`);
      failed.push(name);
    }
  }

  const verb = dryRun ? 'would build' : 'built';
  const summary = `${verb} ${built.length}, skipped ${skipped.length}, failed ${failed.length}`;
  if (failed.length > 0) {
    fail(summary);
    fail(`Failed packages: ${failed.join(', ')}`);
  } else {
    success(summary);
  }

  return { built, skipped, failed };
}

module.exports = {
  buildAllPackages,
};
