/**
 * @fileoverview Find and terminate running `ntk --dev` / `--watch` processes.
 *
 * `--reset` rebuilds every package's dist, dedupes node_modules, then wipes
 * caches. A concurrently-running `ntk --dev --watch` writes the same dist
 * files (`rollup -c -w`) and holds node_modules references, so its output
 * races the rebuild and dedupe mutates modules under it. This module locates
 * any such instance and sends it SIGTERM — its own shutdown handler
 * (handle-dev-watch.js) then tears down the detached npm+rollup child groups,
 * so nothing orphans. Stragglers that ignore SIGTERM are SIGKILLed.
 *
 * @module dev-watch-killer
 */

const { execSync } = require('child_process');
const { info, warn, gray } = require('../shared/logger');

/**
 * Synchronous sleep without a busy-loop — used to give signaled processes a
 * grace window to exit before we re-scan. Cross-platform (no `sleep` binary).
 *
 * @param {number} ms - Milliseconds to block
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * True when a process command line is a `ntk`/`nice-toolkit` invocation that
 * includes `--dev` and/or `--watch`. Both bin names (the `ntk` alias and the
 * `nice-toolkit` long form) resolve to the same script, so match either.
 *
 * @param {string} args - Full process command line
 * @returns {boolean}
 */
function isDevWatchCommand(args) {
  // `ntk`/`nice-toolkit` as its own path segment or word — not a substring of
  // some unrelated path.
  const isToolkit = /(?:^|[/\s])(?:nice-toolkit|ntk)(?:\s|$)/.test(args);
  const isDevWatch = /\s--(?:dev|watch)\b/.test(args);
  return isToolkit && isDevWatch;
}

/**
 * List `{ pid, args }` for running toolkit dev/watch processes via `ps`.
 * POSIX only — returns `[]` on Windows or if `ps` is unavailable. Excludes the
 * current process and any `--reset` invocation (so a running reset never
 * signals itself).
 *
 * @returns {{ pid: number, args: string }[]}
 */
function findDevWatchProcesses() {
  if (process.platform === 'win32') return [];

  let out;
  try {
    out = execSync('ps -Ao pid=,args=', { encoding: 'utf8' });
  } catch {
    // `ps` missing or denied — nothing we can do; treat as none found.
    return [];
  }

  const self = process.pid;
  const matches = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // `pid args...` — split on the first space.
    const sp = trimmed.indexOf(' ');
    if (sp === -1) continue;
    const pid = parseInt(trimmed.slice(0, sp), 10);
    const args = trimmed.slice(sp + 1);

    if (!Number.isInteger(pid) || pid === self) continue;
    // Never signal a running --reset (ourselves or a sibling reset).
    if (/\s--reset\b/.test(args)) continue;
    if (isDevWatchCommand(args)) matches.push({ pid, args });
  }
  return matches;
}

/**
 * Terminate any running `ntk --dev`/`--watch` instances before a reset.
 *
 * Sends SIGTERM so each instance runs its graceful shutdown (which kills its
 * detached rollup child groups), waits a grace window, then SIGKILLs anything
 * that survived. Idempotent and safe when none are running.
 *
 * @param {{ dryRun?: boolean }} [options]
 * @returns {number} Count of processes signaled (or that would be, in dry run)
 */
function terminateDevWatchers({ dryRun = false } = {}) {
  if (process.platform === 'win32') {
    warn('Cannot auto-stop dev/watch on Windows — stop `ntk --dev --watch` manually before --reset.');
    return 0;
  }

  const procs = findDevWatchProcesses();
  if (procs.length === 0) return 0;

  // Phase 1 — SIGTERM each, letting its own handler stop the rollup children.
  for (const { pid, args } of procs) {
    info(`Stopping dev/watch process ${pid}`);
    console.log(`  ${gray(args.length > 100 ? `${args.slice(0, 97)}...` : args)}`);
    if (dryRun) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }

  if (dryRun) return procs.length;

  // Phase 2 — grace window, then SIGKILL any that ignored SIGTERM.
  sleepSync(1000);
  for (const { pid } of findDevWatchProcesses()) {
    warn(`dev/watch process ${pid} did not stop on SIGTERM — sending SIGKILL`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }

  return procs.length;
}

module.exports = {
  terminateDevWatchers,
  findDevWatchProcesses,
  isDevWatchCommand,
};