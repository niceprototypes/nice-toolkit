/**
 * @fileoverview The reload lifecycle reducer — parser events → model mutations.
 *
 * dev-runner parses each watcher line once (`dev-output-parser`); the same events drive the
 * cycle tracker (which ends cycles) and, here, the steps of the tree model. A settled package
 * starts a new cycle on its next output.
 *
 * @module cli/develop/lifecycle
 */

/**
 * Applies one watcher output line, already parsed, to the model.
 *
 * @param {ReturnType<import('./tree-model').createTreeModel>} model
 * @param {string} pkg
 * @param {string} line - The raw line
 * @param {import('./dev-output-parser').ParseEvent[]} events - `line`'s parser events
 */
function feedEvents(model, pkg, line, events) {
  for (const event of events) {
    const entry = model.get(pkg);
    if (!entry || entry.state === 'exited') return;
    if (event.type === 'cycle-end') continue;
    if (entry.state !== 'building') model.cycleStart(pkg);
    model.markActiveDone(pkg);
    switch (event.type) {
      case 'warning':
        model.sub(pkg, { text: event.text, state: 'warning', detail: event.detail });
        break;
      case 'error':
        model.sub(pkg, { text: event.text, state: 'failed' });
        break;
      default:
        // build-start, a finished step, or unrecognized output: the newest step
        model.sub(pkg, { text: event.text, state: 'active' });
    }
  }
  model.raw(pkg, line);
}

module.exports = { feedEvents };
