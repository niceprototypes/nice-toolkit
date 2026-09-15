/**
 * @fileoverview The develop tree state — a pure, event-fed model.
 *
 * One entry per linked package, each cycling
 * `idle → reloading → settling → settled → reloading …` forever. The model holds
 * no timers and writes nothing; the orchestrator drives it with events and the
 * view derives lines from it. Keeping it side-effect-free makes the demo
 * harness (fixture replay) and the live run share the exact same state code.
 *
 * @module cli/develop/tree-model
 */

// A chatty tool (rollup + dts + tsc all logging) can emit many lines per cycle;
// cap what we retain so the active package's block can't outgrow the viewport.
// The count still surfaces in the settled summary.
const MAX_SUBITEMS = 6;

/**
 * @typedef {'idle'|'reloading'|'settling'|'settled'} PkgState
 *
 * @typedef {object} SubItem
 * @property {string} id
 * @property {string} text
 * @property {'active'|'done'|'warning'|'failed'} state
 * @property {string} [detail] - Secondary line (e.g. a warning's file path).
 *
 * @typedef {object} PkgEntry
 * @property {string} name
 * @property {PkgState} state
 * @property {import('../../shared/tasks/status').Outcome | null} outcome
 * @property {number} warnings
 * @property {boolean} failed
 * @property {SubItem[]} subItems
 * @property {string[]} rawOnFail - Captured raw lines, dumped only if the cycle fails.
 * @property {number} startedAt - ms timestamp the current reload began.
 * @property {number} cycle - Monotonic id; drops late pings from a closed cycle.
 * @property {number} order - Stable display order (registration order).
 */

/**
 * Creates an empty tree model.
 * @param {() => number} now - Injected clock (Date.now in prod; fixture-driven in the demo).
 * @returns {object}
 */
function createTreeModel(now = Date.now) {
  /** @type {Map<string, PkgEntry>} */
  const pkgs = new Map();
  let order = 0;

  /** Registers a package (idempotent), so it appears in the roster from the start. */
  function ensure(name) {
    let e = pkgs.get(name);
    if (!e) {
      e = {
        name,
        state: 'idle',
        outcome: null,
        warnings: 0,
        failed: false,
        subItems: [],
        rawOnFail: [],
        startedAt: 0,
        cycle: 0,
        order: order++,
      };
      pkgs.set(name, e);
    }
    return e;
  }

  /** Begins a fresh reload cycle for `name`, clearing the previous cycle's items. */
  function reloadStart(name) {
    const e = ensure(name);
    e.state = 'reloading';
    e.outcome = null;
    e.warnings = 0;
    e.failed = false;
    e.subItems = [];
    e.rawOnFail = [];
    e.startedAt = now();
    e.cycle += 1;
    return e.cycle;
  }

  /**
   * Flips any still-spinning (`active`) sub-item to `done`. Called before adding
   * a new sub-item so only the newest one braille-spins and everything above it
   * reads as `✓` — the streaming effect from the mockup.
   */
  function markActiveDone(name) {
    const e = ensure(name);
    for (const s of e.subItems) if (s.state === 'active') s.state = 'done';
  }

  /** Appends a sub-item under the active package. */
  function sub(name, { text, state = 'active', detail }) {
    const e = ensure(name);
    if (e.state !== 'reloading') return;
    e.subItems.push({ id: `s${e.subItems.length}`, text, state, detail });
    if (e.subItems.length > MAX_SUBITEMS) e.subItems.shift();
    if (state === 'warning') e.warnings += 1;
    if (state === 'failed') e.failed = true;
  }

  /** Records a raw line for potential failure dump. */
  function raw(name, line) {
    const e = ensure(name);
    if (e.rawOnFail.length < 200) e.rawOnFail.push(line);
  }

  /**
   * Settles the current cycle. Ignored if `cycle` is stale (a late ping from an
   * already-closed cycle). Returns the settled entry, or null if dropped.
   */
  function settle(name, cycle) {
    const e = pkgs.get(name);
    if (!e || e.state !== 'reloading' || (cycle != null && cycle !== e.cycle)) return null;
    e.state = 'settled';
    if (e.failed) {
      e.outcome = { kind: 'failed', detail: 'build failed' };
    } else if (e.warnings > 0) {
      e.outcome = { kind: 'warned', count: e.warnings };
    } else {
      e.outcome = { kind: 'done' };
    }
    return e;
  }

  return {
    ensure,
    reloadStart,
    markActiveDone,
    sub,
    raw,
    settle,
    get(name) {
      return pkgs.get(name);
    },
    all() {
      return Array.from(pkgs.values()).sort((a, b) => a.order - b.order);
    },
    active() {
      return this.all().filter((e) => e.state === 'reloading' || e.state === 'settling');
    },
    anyActive() {
      return this.all().some((e) => e.state === 'reloading' || e.state === 'settling');
    },
  };
}

module.exports = { createTreeModel, MAX_SUBITEMS };
