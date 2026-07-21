/**
 * @fileoverview Build-tool cache removal + dev-server port lifecycle
 *
 * Webpack (CRA) and Vite cache their dependency analysis in
 * node_modules/.cache and node_modules/.vite respectively. After source
 * changes in linked nice-* packages, these caches keep serving stale
 * resolutions until invalidated.
 *
 * A bare cache wipe is not sufficient when a dev server is running — the
 * server holds an in-memory module graph and repopulates the on-disk cache
 * immediately on the next request. So this module also discovers the ports
 * each consumer's dev server uses, kills any process bound to those ports,
 * then wipes the caches.
 *
 * @module cache-cleaner
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { pathExists, removePath, readDir } = require('../shared/fs-utils');
const { log, info, success, warn, gray } = require('../shared/logger');

// Generic build-tool cache that `clean` always wipes — webpack/CRA, Storybook,
// and Babel all cache under node_modules/.cache. Kept framework-agnostic on
// purpose: `clean` knows nothing about any specific bundler.
const CACHE_DIRS = ['.cache'];

// Framework-specific caches, opt-in per flag so the core `clean` stays agnostic.
// Adding a framework is one entry here + one flag in the CLI (e.g. `--next`) —
// nothing in the core clean path changes.
//   vite → node_modules/.vite   (Vite's optimized-deps cache; `clean --vite`)
//   next → node_modules/.next   (future; `clean --next`)
const TOOL_CACHE_DIRS = {
  vite: ['.vite'],
};

// ──────────────────────────────────────────────────────────────────────────────
// Port discovery
// ──────────────────────────────────────────────────────────────────────────────

const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

/**
 * Extracts PORT=<number> from .env-style files in a directory.
 *
 * @param {string} dir - Consumer directory
 * @returns {number[]}
 */
function readPortsFromEnv(dir) {
  const ports = [];
  for (const name of ENV_FILES) {
    const file = path.join(dir, name);
    if (!pathExists(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/^\s*PORT\s*=\s*(\d{2,5})\s*$/gm)) {
      ports.push(Number(match[1]));
    }
  }
  return ports;
}

/**
 * Extracts ports declared via `-p <num>`, `--port <num>`, or `--port=<num>`
 * in any of the package.json scripts.
 *
 * @param {string} dir - Consumer directory
 * @returns {number[]}
 */
function readPortsFromPackageScripts(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!pathExists(pkgPath)) return [];
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }
  const scripts = pkg.scripts || {};
  const ports = [];
  for (const cmd of Object.values(scripts)) {
    if (typeof cmd !== 'string') continue;
    // -p 6006, --port 6006, --port=6006
    for (const match of cmd.matchAll(/(?:^|\s)(?:-p|--port)(?:\s+|=)(\d{2,5})\b/g)) {
      ports.push(Number(match[1]));
    }
  }
  return ports;
}

/**
 * Returns the set of dev-server ports declared by a consumer.
 * Combines .env PORT entries and package.json script `--port`/`-p` flags.
 *
 * @param {string} dir - Consumer directory
 * @returns {number[]}
 */
function discoverPorts(dir) {
  const set = new Set([
    ...readPortsFromEnv(dir),
    ...readPortsFromPackageScripts(dir),
  ]);
  return [...set];
}

// ──────────────────────────────────────────────────────────────────────────────
// Port kill (cross-platform)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Kills any process listening on the given port. Idempotent — a port with
 * no bound process is a no-op. Failures (missing tool, permission denied)
 * are non-fatal; they surface as a warning but do not abort the run.
 *
 * @param {number} port
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {boolean} true if a kill was issued (or would be in dry run)
 */
function killPort(port, { dryRun = false } = {}) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = [...new Set(
        out
          .split('\n')
          .filter(line => line.includes(`:${port}`))
          .map(line => line.trim().split(/\s+/).pop())
          .filter(pid => pid && /^\d+$/.test(pid))
      )];
      if (pids.length === 0) return false;
      if (!dryRun) {
        for (const pid of pids) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch { /* gone */ }
        }
      }
      return true;
    }
    const out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
    if (!out) return false;
    if (!dryRun) {
      for (const pid of out.split('\n').filter(Boolean)) {
        try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); } catch { /* gone */ }
      }
    }
    return true;
  } catch {
    // lsof returns non-zero when nothing is bound. Treat as no-op.
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cache directory removal
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cleans build-tool caches in a single project directory.
 *
 * @param {string} dir - Project directory containing node_modules
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {string[]} Paths that were removed (or would be in dry run)
 */
function cleanCachesInDir(dir, { dryRun = false, tools = [] } = {}) {
  const nodeModules = path.join(dir, 'node_modules');
  if (!pathExists(nodeModules)) return [];

  // Generic caches always; each requested tool's caches on top.
  const cacheDirs = [...CACHE_DIRS, ...tools.flatMap((tool) => TOOL_CACHE_DIRS[tool] || [])];

  const removed = [];
  for (const cacheName of cacheDirs) {
    const target = path.join(nodeModules, cacheName);
    if (!pathExists(target)) continue;
    if (!dryRun) removePath(target);
    removed.push(target);
  }
  return removed;
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace-wide entry point
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Walks every immediate subdirectory of the workspace base path. For each
 * consumer that declares dev-server ports (via .env or package.json scripts),
 * kills any process bound to those ports. Then wipes the generic build-tool
 * cache (.cache) across the workspace — plus any opt-in tool caches named in
 * `tools` (e.g. `['vite']` → also .vite). The core is framework-agnostic; tool
 * caches are added only when a flag asks for them.
 *
 * The port-kill step is required because a running dev server holds an
 * in-memory module graph and repopulates its on-disk cache immediately on
 * the next request. Wiping cache without killing the server is a no-op
 * against the observable symptom.
 *
 * @param {string} baseDir - Workspace root (e.g. ~/nice)
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.killPorts=true] - Set false to wipe caches only
 * @param {string[]} [options.tools=[]] - Tool-cache keys to also wipe (see TOOL_CACHE_DIRS)
 */
function cleanAllCaches(baseDir, { dryRun = false, killPorts = true, tools = [] } = {}) {
  if (!pathExists(baseDir)) {
    log(`Workspace base not found: ${baseDir}`);
    return;
  }

  const entries = readDir(baseDir);

  // Phase 1 — port discovery + kill
  let killedCount = 0;
  if (killPorts) {
    const seen = new Set();
    for (const entry of entries) {
      const dir = path.join(baseDir, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const ports = discoverPorts(dir);
      for (const port of ports) {
        if (seen.has(port)) continue;
        seen.add(port);
        const verb = dryRun ? 'would kill process on port' : 'killed process on port';
        const issued = killPort(port, { dryRun });
        if (issued) {
          info(`${verb} ${port} ${gray(`(${entry})`)}`);
          killedCount++;
        }
      }
    }
    if (seen.size === 0) {
      log('No dev-server ports declared in any consumer.');
    } else if (killedCount === 0) {
      log(`No processes bound to known ports (${[...seen].sort((a, b) => a - b).join(', ')}).`);
    }
  }

  // Phase 2 — cache removal
  let totalRemoved = 0;
  for (const entry of entries) {
    const dir = path.join(baseDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const removed = cleanCachesInDir(dir, { dryRun, tools });
    for (const target of removed) {
      const verb = dryRun ? 'would remove' : 'removed';
      info(`${verb} ${gray(target)}`);
      totalRemoved++;
    }
  }

  if (totalRemoved === 0) {
    log('No build-tool caches found.');
  } else {
    const verb = dryRun ? 'would clean' : 'cleaned';
    success(`${verb} ${totalRemoved} cache director${totalRemoved === 1 ? 'y' : 'ies'}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Vite optimized-deps refresh
// ──────────────────────────────────────────────────────────────────────────────

// Vite pre-bundles dependencies into an optimized-deps cache. Plain Vite
// consumers use node_modules/.vite; Storybook's Vite builder nests its own
// under node_modules/.cache. A rebuilt linked dist (e.g. SVGR-built icons after
// --build-icons) is ignored until these are wiped, because Vite keeps serving
// the copy it bundled at server start.
const VITE_CACHE_DIRS = ['.vite', '.cache/storybook', '.cache/sb-vite-plugin-externals'];

/**
 * Removes Vite's optimized-deps caches in a single project directory.
 *
 * @param {string} dir - Project directory containing node_modules
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {string[]} Paths that were removed (or would be in dry run)
 */
function removeViteCachesInDir(dir, { dryRun = false } = {}) {
  const nodeModules = path.join(dir, 'node_modules');
  if (!pathExists(nodeModules)) return [];

  const removed = [];
  for (const rel of VITE_CACHE_DIRS) {
    const target = path.join(nodeModules, ...rel.split('/'));
    if (!pathExists(target)) continue;
    if (!dryRun) removePath(target);
    removed.push(target);
  }
  return removed;
}

/**
 * Invalidates Vite's optimized-deps cache across the workspace and bounces any
 * running dev servers, so a rebuilt linked dist is actually re-bundled and
 * served rather than read from the stale pre-bundle.
 *
 * The port-kill is required, not optional: a running dev server holds the
 * optimized deps in memory and repopulates the on-disk cache on the next
 * request, so wiping alone is a no-op against the observable symptom. Callers
 * restart their dev server afterward to trigger re-optimization.
 *
 * @param {string} baseDir - Workspace root (e.g. ~/nice)
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.killPorts=true] - Set false to wipe caches only
 */
function refreshVite(baseDir, { dryRun = false, killPorts = true } = {}) {
  if (!pathExists(baseDir)) {
    log(`Workspace base not found: ${baseDir}`);
    return;
  }

  const entries = readDir(baseDir);

  // Phase 1 — bounce dev servers so they re-optimize on restart.
  if (killPorts) {
    const seen = new Set();
    let killedCount = 0;
    for (const entry of entries) {
      const dir = path.join(baseDir, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const port of discoverPorts(dir)) {
        if (seen.has(port)) continue;
        seen.add(port);
        if (killPort(port, { dryRun })) {
          info(`${dryRun ? 'would kill process on port' : 'killed process on port'} ${port} ${gray(`(${entry})`)}`);
          killedCount++;
        }
      }
    }
    if (seen.size > 0 && killedCount === 0) {
      log(`No processes bound to known ports (${[...seen].sort((a, b) => a - b).join(', ')}).`);
    }
  }

  // Phase 2 — wipe Vite optimized-deps caches.
  let totalRemoved = 0;
  for (const entry of entries) {
    const dir = path.join(baseDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const target of removeViteCachesInDir(dir, { dryRun })) {
      info(`${dryRun ? 'would remove' : 'removed'} ${gray(target)}`);
      totalRemoved++;
    }
  }

  if (totalRemoved === 0) {
    log('No Vite optimized-deps caches found.');
  } else {
    success(`${dryRun ? 'would refresh' : 'refreshed'} Vite deps — ${totalRemoved} cache${totalRemoved === 1 ? '' : 's'} wiped; restart your dev server to re-bundle`);
  }
}

module.exports = {
  cleanCachesInDir,
  cleanAllCaches,
  removeViteCachesInDir,
  refreshVite,
  discoverPorts,
  killPort,
};
