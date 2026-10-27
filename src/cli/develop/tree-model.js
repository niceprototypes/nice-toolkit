/**
 * @fileoverview The develop tree state — a pure, event-fed model.
 *
 * One entry per linked package: `queued → building → settled → building …`, or `exited`
 * when its watcher process ends. The model holds no timers and writes nothing; dev-runner's
 * events drive it (through `lifecycle`) and `tree-view` derives lines from it.
 *
 * A failed cycle's diagnostics (every raw line from its first error on) stay pinned until the
 * package's next successful cycle.
 *
 * @module cli/develop/tree-model
 */

// The live tree shows a building package's last MAX_SUBITEMS steps; the model keeps the cycle's
// steps up to MAX_STEPS (--verbose prints them all when the package finishes).
const MAX_SUBITEMS = 6;
const MAX_STEPS = 200;
// Raw lines kept per package: the diagnostics of a failed cycle, and the last lines before an exit
const MAX_DIAGNOSTICS = 200;
const MAX_RECENT = 20;

/**
 * @typedef {'queued'|'building'|'settled'|'exited'} PkgState
 *
 * @typedef {object} SubItem
 * @property {string} text
 * @property {'active'|'done'|'warning'|'failed'} state
 * @property {string} [detail] - Secondary line (e.g. a warning's file path).
 *
 * @typedef {object} PkgEntry
 * @property {string} name
 * @property {Set<string>} deps - Dependencies among the running packages
 * @property {PkgState} state
 * @property {import('../../shared/tasks/status').Outcome | null} outcome - The last settled cycle's
 * @property {number} warnings
 * @property {string | null} firstError - The current cycle's first error line
 * @property {SubItem[]} subItems - The current cycle's steps
 * @property {string[] | null} diagnostics - Raw lines from the current cycle's first error on, stack frames aside
 * @property {string[]} recent - The last raw lines, for an unexpected exit
 * @property {string[] | null} pinned - The diagnostics of the last failed cycle, until one succeeds
 * @property {boolean} builtOnce
 * @property {number} startedAt - When the current cycle began
 * @property {number} duration - The last settled cycle's duration, ms
 * @property {number} settledAt
 * @property {number | null} outputBytes - dist/ total when the last cycle settled (null without one)
 * @property {number} outputAt - When the package last printed
 * @property {number} order - Display order (registration order)
 */

/**
 * Creates an empty tree model.
 * @param {() => number} now - Injected clock
 */
function createTreeModel(now = Date.now) {
  /** @type {Map<string, PkgEntry>} */
  const pkgs = new Map();
  const reloads = { count: 0, at: 0, pkg: null };
  let allBuiltIn = null;

  /** Registers a package as queued (idempotent), so it appears in the roster from the start. */
  function register(name, deps = new Set()) {
    if (pkgs.has(name)) return pkgs.get(name);
    const entry = {
      name,
      deps,
      state: 'queued',
      outcome: null,
      warnings: 0,
      firstError: null,
      subItems: [],
      diagnostics: null,
      recent: [],
      pinned: null,
      builtOnce: false,
      startedAt: 0,
      duration: 0,
      settledAt: 0,
      outputBytes: null,
      outputAt: 0,
      order: pkgs.size,
    };
    pkgs.set(name, entry);
    return entry;
  }

  /** Begins a build cycle: the watcher's start, or a rebuild after a settled cycle. */
  function cycleStart(name) {
    const entry = register(name);
    entry.state = 'building';
    entry.warnings = 0;
    entry.firstError = null;
    entry.subItems = [];
    entry.diagnostics = null;
    entry.startedAt = now();
  }

  /** Flips the spinning sub-item to done, so only the newest one spins. */
  function markActiveDone(name) {
    for (const item of register(name).subItems) if (item.state === 'active') item.state = 'done';
  }

  /** Appends a step under a building package. */
  function sub(name, { text, state = 'active', detail }) {
    const entry = register(name);
    if (entry.state !== 'building') return;
    if (entry.subItems.length < MAX_STEPS) entry.subItems.push({ text, state, detail });
    if (state === 'warning') entry.warnings += 1;
    if (state === 'failed') {
      entry.firstError ??= text;
      entry.diagnostics ??= [];
    }
  }

  /**
   * Records a raw output line: kept as a diagnostic once the cycle has failed (JavaScript stack
   * frames aside: `--raw` shows those), and as recent output.
   */
  function raw(name, line) {
    const entry = register(name);
    entry.outputAt = now();
    const isStackFrame = /^\s+at /.test(line);
    if (entry.diagnostics && !isStackFrame && entry.diagnostics.length < MAX_DIAGNOSTICS) entry.diagnostics.push(line);
    entry.recent.push(line);
    if (entry.recent.length > MAX_RECENT) entry.recent.shift();
  }

  /**
   * Ends the current cycle with the watcher's outcome (cycle-tracker).
   *
   * @param {string} name
   * @param {import('./cycle-tracker').CycleOutcome} outcome
   * @param {{ exitCode?: number | null, outputBytes?: number | null }} [info]
   */
  function settle(name, outcome, { exitCode = null, outputBytes = null } = {}) {
    const entry = pkgs.get(name);
    if (!entry || entry.state === 'exited') return;
    markActiveDone(name);
    entry.settledAt = now();
    entry.duration = entry.settledAt - entry.startedAt;
    entry.outputBytes = outputBytes;
    if (outcome === 'exited') {
      entry.state = 'exited';
      entry.outcome = { kind: 'failed', detail: `Exited${exitCode === null ? '' : ` with code ${exitCode}`}` };
      entry.pinned = entry.diagnostics ?? [...entry.recent];
      return;
    }
    entry.state = 'settled';
    entry.builtOnce = true;
    if (outcome === 'failed') {
      entry.outcome = { kind: 'failed', detail: entry.firstError ?? 'build failed' };
      entry.pinned = entry.diagnostics ?? [...entry.recent];
    } else {
      entry.outcome = entry.warnings > 0 ? { kind: 'warned', count: entry.warnings } : { kind: 'done' };
      entry.pinned = null;
    }
  }

  /** Counts a consumer reload (the watcher touched the trigger file for `name`). */
  function reloadPing(name) {
    reloads.count += 1;
    reloads.at = now();
    reloads.pkg = name;
  }

  /** Records that every package finished its first build, `ms` after the start. */
  function allBuilt(ms) {
    allBuiltIn = ms;
  }

  const all = () => Array.from(pkgs.values()).sort((a, b) => a.order - b.order);

  return {
    register,
    cycleStart,
    markActiveDone,
    sub,
    raw,
    settle,
    reloadPing,
    allBuilt,
    get: (name) => pkgs.get(name),
    all,
    reloads: () => ({ ...reloads }),
    allBuiltIn: () => allBuiltIn,
    anyBuilding: () => all().some((entry) => entry.state === 'building'),
  };
}

module.exports = { createTreeModel, MAX_SUBITEMS };
