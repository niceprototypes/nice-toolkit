/**
 * @fileoverview Runs dev scripts in all linked packages concurrently
 *
 * Discovers all file: linked packages and runs their `npm run dev` scripts
 * in parallel. This rebuilds packages on source changes, enabling hot-reload
 * workflows for local development.
 *
 * @module dev-runner
 */

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { findAllLinkedPackages } = require('./discovery');
const { getPackageName, directorySize } = require('../shared/fs-utils');
const { log, info, success, warn, cyan, gray } = require('../shared/logger');
const { createParser } = require('../cli/develop/dev-output-parser');
const { createCycleTracker } = require('../cli/develop/cycle-tracker');
const { buildStartGraph, scheduleStarts, startOrder } = require('./start-order');
const { probeProcess, recordGroup, forgetOwner, cleanOrphanedGroups, warnMissingBuilds } = require('./dev-groups');

/** Runs `npm run dev` as the leader of the watcher's process group (see the module). */
const GROUP_LEADER = path.join(__dirname, 'dev-group-leader.js');

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ANSI color codes for terminal output
 * @constant {string[]}
 */
const COLORS = [
  '\x1b[36m', // cyan
  '\x1b[33m', // yellow
  '\x1b[35m', // magenta
  '\x1b[32m', // green
  '\x1b[34m', // blue
  '\x1b[31m', // red
];

const RESET = '\x1b[0m';

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a package has a dev script
 *
 * @param {string} pkgPath - Absolute path to package
 * @returns {boolean} True if package has a dev script
 */
function hasDevScript(pkgPath) {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8')
    );
    return Boolean(pkgJson.scripts?.dev);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Dev Runner
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Spawns a dev process for a single package
 *
 * @param {string} pkgPath - Absolute path to package
 * @param {object} handlers
 * @param {(line: string, events: import('../cli/develop/dev-output-parser').ParseEvent[]) => void} handlers.onLine
 *   Each output line (stdout and stderr), with its parser events
 * @param {(outcome: import('../cli/develop/cycle-tracker').CycleOutcome, exitCode: number | null) => void} handlers.onCycle
 *   Each build cycle's end; `exited` (with the exit code) when the process ends
 * @returns {ChildProcess}
 */
function spawnDevProcess(pkgPath, { onLine, onCycle }) {
  const pkgName = getPackageName(pkgPath);

  // `detached: true` puts the child in its own process group so the
  // controller can signal the whole tree (leader + npm + rollup -c -w) with
  // one call to `process.kill(-pid, ...)` on shutdown.
  //
  // The child is the group leader script, not npm: it stops the group when
  // its stdin pipe closes, which happens however this process ends (SIGKILL
  // included), so the watchers never outlive `nicely develop`.
  const child = spawn(process.execPath, [GROUP_LEADER], {
    cwd: pkgPath,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // One parser per child, so interleaved output never mixes. Its events feed the cycle tracker
  // (which gates this package's dependents) and the reporter.
  const parser = createParser(pkgName);
  let exitCode = null;
  const cycles = createCycleTracker({ onCycle: (outcome) => onCycle(outcome, exitCode) });

  // readline yields whole lines, even when a line arrives split across two data chunks
  const relay = (input) => {
    readline.createInterface({ input, crlfDelay: Infinity }).on('line', (line) => {
      const events = parser.feed(line);
      onLine(line, events);
      cycles.feed(events);
    });
  };
  relay(child.stdout);
  relay(child.stderr);

  child.on('error', (err) => {
    onLine(`Failed to start: ${err.message}`, []);
    cycles.exit();
  });

  child.on('exit', (code) => {
    exitCode = code;
    cycles.exit();
  });

  return child;
}

/**
 * @typedef {object} DevReporter - What `nicely develop` shows; the develop view or the raw stream
 * @property {(graph: Map<string, Set<string>>, order: string[]) => void} begin
 * @property {(names: string[], waitedFor: string[]) => void} starting - A batch of watchers starts
 * @property {(name: string, line: string, events: object[]) => void} output - A watcher printed a line
 * @property {(name: string, outcome: string, info: { exitCode: number | null, outputBytes: number | null }) => void} cycle
 *   A build cycle ended; `outputBytes`: the package's dist/ total at that moment (null without one)
 * @property {(name: string, outcome: import('./start-order').StartOutcome) => void} firstBuild
 *   A first build settled for the start order (also `timeout`)
 * @property {(names: string[]) => void} dependencyCycle
 * @property {(count: number, ms: number) => void} allBuilt
 */

/**
 * The raw reporter (`--raw`): every watcher line prefixed with its package name, plus the
 * start-order log lines.
 *
 * @returns {DevReporter}
 */
function createRawReporter() {
  const prefixes = new Map();
  const short = (names) => names.map((name) => name.replace(/^nice-/, '')).join(', ');
  const prefix = (name) => {
    if (!prefixes.has(name)) {
      const color = COLORS[prefixes.size % COLORS.length];
      prefixes.set(name, `${color}[${name.replace('nice-', '').padEnd(20)}]${RESET} `);
    }
    return prefixes.get(name);
  };
  return {
    begin(graph, order) {
      log(`Running dev scripts in ${cyan(order.length)} linked packages, dependencies first:\n`);
      for (const name of order) console.log(`  ${gray('•')} ${name}`);
      console.log('');
    },
    starting: (names, waitedFor) =>
      info(`Starting ${short(names)}${waitedFor.length ? gray(` (after ${short(waitedFor)})`) : ''}`),
    output(name, line) {
      if (line) process.stdout.write(`${prefix(name)}${line}\n`);
    },
    cycle(name, outcome, { exitCode }) {
      if (outcome === 'exited' && exitCode !== 0 && exitCode !== null) console.log(`${prefix(name)}Exited with code ${exitCode}`);
    },
    firstBuild(name, outcome) {
      // Dependents start whatever happened; say when a dependency's first build was not clean
      if (outcome !== 'ready') warn(`${name}: first build ${outcome} — starting its dependents anyway`);
    },
    dependencyCycle: (names) => warn(`Dependency cycle among ${short(names)} — starting them together`),
    allBuilt: (count, ms) =>
      success(`All ${count} dev processes built once in ${(ms / 1000).toFixed(1)}s. Press Ctrl+C to stop.\n`),
  };
}

/**
 * Dev runner options
 * @typedef {object} DevRunnerOptions
 * @property {boolean} [verbose=false] - Log detailed information
 * @property {string} pidFile - Record of the running watcher groups (see dev-groups)
 * @property {DevReporter} [reporter] - Default: the raw prefixed stream
 */

/**
 * Starts dev scripts in all linked packages
 *
 * @param {string} projectDir - Project root directory
 * @param {DevRunnerOptions} [options={}] - Runner configuration
 * @returns {{ stop: () => void, processes: Array }} Controller to stop all processes
 *
 * @example
 * const controller = startDevRunner('/path/to/my-app');
 * // Later...
 * controller.stop();
 */
function startDevRunner(projectDir, options = {}) {
  const { verbose = false, pidFile, reporter = createRawReporter() } = options;

  // Watchers a previous `nicely develop` left running would race the new ones on the same dist/
  const { orphaned, liveOwners, ended } = cleanOrphanedGroups(pidFile);
  if (orphaned.length > 0) {
    info(`Stopped ${orphaned.length} watcher${orphaned.length === 1 ? '' : 's'} left running by an earlier nicely develop`);
  }
  warnMissingBuilds(ended.map((entry) => entry.cwd), 'This run rebuilds them.');
  for (const owner of liveOwners) {
    warn(`nicely develop is already running (pid ${owner.pid}); stop it with ${cyan('nicely develop --stop')}`);
  }

  // Find all linked packages
  const linkedPackages = findAllLinkedPackages(projectDir);

  if (linkedPackages.size === 0) {
    warn('No linked packages found. Nothing to run.');
    return { stop: () => {}, processes: [] };
  }

  // Filter to only packages with dev scripts
  const packages = Array.from(linkedPackages).filter((pkgPath) => {
    if (!hasDevScript(pkgPath)) {
      const pkgName = getPackageName(pkgPath);
      info(`Skipping ${pkgName} (no dev script)`);
      return false;
    }
    return true;
  });

  if (packages.length === 0) {
    warn('No packages have dev scripts. Nothing to run.');
    return { stop: () => {}, processes: [] };
  }

  // Start dev processes in dependency order: a watcher starts once the nice-* packages it
  // depends on have finished their first build, so it never reads their types mid-write
  // (see start-order).
  const processes = [];
  const pathByName = new Map(packages.map((pkgPath) => [getPackageName(pkgPath), pkgPath]));
  const graph = buildStartGraph([...pathByName].map(([name, pkgPath]) => ({ name, path: pkgPath })));
  let stopped = false;
  const owner = probeProcess(process.pid);
  const startedAt = Date.now();
  // Shutdown stops every watcher: their exits are not reported
  const report = (method) => (...args) => {
    if (!stopped) reporter[method](...args);
  };

  reporter.begin(graph, startOrder(graph));

  scheduleStarts(
    graph,
    (name) =>
      new Promise((resolve) => {
        const pkgPath = pathByName.get(name);
        let first = true;
        const child = spawnDevProcess(pkgPath, {
          onLine: (line, events) => report('output')(name, line, events),
          onCycle: (outcome, exitCode) => {
            report('cycle')(name, outcome, { exitCode, outputBytes: directorySize(path.join(pkgPath, 'dist')) });
            if (first) resolve(outcome);
            first = false;
          },
        });
        processes.push({ name, process: child });
        recordGroup(pidFile, { pgid: child.pid, cwd: pkgPath, owner });
      }),
    {
      isStopped: () => stopped,
      onStart: report('starting'),
      onSettled: report('firstBuild'),
      onCycle: report('dependencyCycle'),
    }
  ).then((outcomes) => report('allBuilt')(outcomes.size, Date.now() - startedAt));

  // Return controller
  return {
    processes,
    stop() {
      if (stopped) return;
      stopped = true;
      for (const { name, process: child } of processes) {
        if (verbose) {
          info(`Stopping ${name}...`);
        }
        // Negative pid signals the entire process group created by
        // `detached: true` — npm AND its rollup grandchild both receive
        // SIGTERM, so neither survives as an orphan.
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Already dead, or no group (race) — fall back to the direct
          // child kill so we still try.
          try { child.kill('SIGTERM'); } catch { /* gone */ }
        }
      }
      forgetOwner(pidFile, owner);
      info('Stopped all dev processes');
      warnMissingBuilds(processes.map(({ name }) => pathByName.get(name)));
    },
  };
}

module.exports = {
  startDevRunner,
  hasDevScript,
};
