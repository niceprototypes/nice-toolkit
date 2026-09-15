/**
 * @fileoverview The reload lifecycle reducer — parser events → model mutations.
 *
 * Timer-free on purpose: the demo harness (synchronous fixture replay) and the
 * live orchestrator (real timers) share this exact reducer, and each owns its
 * own settle timing. A package flips `idle/settled → reloading` on its first
 * build signal, streams sub-items (newest spins, prior settle to ✓), and reports
 * `cycleEnded` when the tool goes idle — the caller decides when to actually
 * settle (immediately in the demo, debounced in the live run, to coalesce a
 * tool's multi-phase "waiting…" burst into one settle).
 *
 * @module cli/develop/lifecycle
 */

/**
 * Applies one raw output line for `pkg` to the model.
 *
 * @param {ReturnType<import('./tree-model').createTreeModel>} model
 * @param {{ feed: (raw: string) => import('./dev-output-parser').ParseEvent[] }} parser
 * @param {string} pkg
 * @param {string} rawLine
 * @returns {{ cycleEnded: boolean, cycle: number }}
 */
function feedLine(model, parser, pkg, rawLine) {
  const events = parser.feed(rawLine);
  let cycleEnded = false;

  for (const ev of events) {
    const entry = model.get(pkg);
    const idle = !entry || entry.state === 'idle' || entry.state === 'settled';

    switch (ev.type) {
      case 'build-start':
      case 'sub':
      case 'passthrough':
        if (idle) model.reloadStart(pkg);
        model.markActiveDone(pkg);
        model.sub(pkg, { text: ev.text, state: 'active' });
        break;

      case 'warning':
        if (idle) model.reloadStart(pkg);
        model.markActiveDone(pkg);
        model.sub(pkg, { text: ev.text, state: 'warning', detail: ev.detail });
        break;

      case 'error':
        if (idle) model.reloadStart(pkg);
        model.markActiveDone(pkg);
        model.sub(pkg, { text: ev.text, state: 'failed', detail: ev.detail });
        break;

      case 'cycle-end':
        // Only meaningful if the package is mid-reload; a stray "waiting…" from
        // an already-idle tool is ignored.
        if (entry && entry.state === 'reloading') {
          model.markActiveDone(pkg);
          cycleEnded = true;
        }
        break;
    }
  }

  const entry = model.get(pkg);
  return { cycleEnded, cycle: entry ? entry.cycle : 0 };
}

/**
 * Records the watcher's post-build reload ping as the confirming sub-item. This
 * lags the build (300ms dist debouncer), so it is a "reloaded" confirmation, not
 * a trigger — it only appends to an in-flight package, never starts one.
 *
 * @param {ReturnType<import('./tree-model').createTreeModel>} model
 * @param {string} pkg
 * @param {number} count - Changed file count.
 */
function feedReloadPing(model, pkg, count) {
  const entry = model.get(pkg);
  if (!entry || entry.state !== 'reloading') return;
  model.markActiveDone(pkg);
  const files = count === 1 ? 'file' : 'files';
  model.sub(pkg, { text: `${pkg} reloaded (${count} ${files})`, state: 'active' });
}

module.exports = { feedLine, feedReloadPing };
