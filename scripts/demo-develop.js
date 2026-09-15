#!/usr/bin/env node
/**
 * @fileoverview Preview harness for the develop live tree — NO child processes,
 * NO watchers. It replays a captured fixture of real `nicely develop` output
 * (including the react-button / react-input / react-tooltip TypeScript
 * diagnostics) through the exact production path: per-package parser → lifecycle
 * reducer → tree model → tree view → live region.
 *
 * Purpose: eyeball the ♥ / braille / ✓ / ⚠ / ✗ rendering before any real wiring.
 * It doubles as a regression fixture for the parser.
 *
 *   node scripts/demo-develop.js
 *
 * @module scripts/demo-develop
 */

const { createTreeModel } = require('../src/cli/develop/tree-model');
const { toLines } = require('../src/cli/develop/tree-view');
const { createParser } = require('../src/cli/develop/dev-output-parser');
const { feedLine, feedReloadPing } = require('../src/cli/develop/lifecycle');
const { createLiveRegion } = require('../src/shared/live-region');

// ── Fixture ───────────────────────────────────────────────────────────────
// Real captured lines, grouped per package. Each entry is fed line-by-line as
// its own child stream would be. Timings are compressed for a quick preview.

const rollupOk = (name) => [
  `> ${name}@1.0.0 dev`,
  '> rollup -c -w',
  'rollup v4.60.2',
  'bundles src/index.ts → dist/index.js, dist/index.esm.js...',
  'created dist/index.js, dist/index.esm.js in 12.5s',
  'bundles dist/types/index.d.ts → dist/index.d.ts...',
  'created dist/index.d.ts in 265ms',
  '[2026-07-28 10:41:31] waiting for changes...',
];

const rollupWarn = (name, file, loc, code, msg) => [
  `> ${name}@1.0.0 dev`,
  '> rollup -c -w',
  'bundles src/index.ts → dist/index.js, dist/index.esm.js...',
  `(!) [plugin typescript] ${file} (${loc}): @rollup/plugin-typescript ${code}: ${msg}`,
  `/Users/mohammedibrahim/nice/${name.replace('nice-', '')}/${file}:${loc.replace(':', ':')}`,
  '',
  `43   const disabled = ${code === 'TS2345' ? 'isDisabled(status)' : 'x'}`,
  '                                 ~~~~~~',
  '',
  'created dist/index.js, dist/index.esm.js in 17.8s',
  '[2026-07-28 10:41:31] waiting for changes...',
];

const PACKAGES = [
  { name: 'nice-react-icon', lines: rollupOk('nice-react-icon') },
  {
    name: 'nice-react-button',
    lines: rollupWarn(
      'nice-react-button',
      'src/components/Button/Button.tsx',
      '43:31',
      'TS2345',
      "Argument of type 'string' is not assignable to parameter of type 'ButtonStatusType'."
    ),
  },
  {
    name: 'nice-react-input',
    lines: rollupWarn(
      'nice-react-input',
      'src/components/Input/Input.tsx',
      '40:31',
      'TS2345',
      "Argument of type 'string' is not assignable to parameter of type 'InputStateType'."
    ),
  },
  { name: 'nice-react-image-vendor', lines: rollupOk('nice-react-image-vendor') },
];

// A tsc package that actually fails a build — exercises the ✗ path + raw dump.
const TSC_FAIL = {
  name: 'nice-styles',
  lines: [
    '10:41:09 AM - Starting compilation in watch mode...',
    "src/index.ts(3,10): error TS2307: Cannot find module './missing'.",
    '10:41:12 AM - Found 1 errors. Watching for file changes.',
  ],
};

// ── Replay engine ───────────────────────────────────────────────────────────

const model = createTreeModel(Date.now);
const region = createLiveRegion({ stream: process.stdout });
const parsers = new Map();
const getParser = (name) => {
  if (!parsers.has(name)) parsers.set(name, createParser(name));
  return parsers.get(name);
};

const LINE_MS = 260; //   gap between a package's lines
const STAGGER_MS = 700; // start offset between packages
const SETTLE_DEBOUNCE = 250;
const TICK_MS = 80;

const timeline = []; // { at, run }
const pushAt = (at, run) => timeline.push({ at, run });

let cursor = 0;
for (const pkg of [...PACKAGES, TSC_FAIL]) {
  const base = cursor;
  pkg.lines.forEach((line, i) => {
    pushAt(base + i * LINE_MS, () => {
      const res = feedLine(model, getParser(pkg.name), pkg.name, line);
      model.raw(pkg.name, line);
      if (res.cycleEnded) {
        const cyc = res.cycle;
        setTimeout(() => model.settle(pkg.name, cyc), SETTLE_DEBOUNCE);
      }
    });
  });
  // A watcher reload ping lands mid-build for one package, to show the confirming sub-item.
  if (pkg.name === 'nice-react-image-vendor') {
    pushAt(base + 4 * LINE_MS, () => feedReloadPing(model, pkg.name, 19));
  }
  cursor = base + STAGGER_MS;
}

const START = Date.now();
let done = false;

const timer = setInterval(() => {
  const elapsed = Date.now() - START;
  while (timeline.length && timeline[0].at <= elapsed) {
    timeline.shift().run();
  }
  region.render(toLines(model, Date.now()));

  if (!done && timeline.length === 0 && !model.anyActive()) {
    done = true;
    clearInterval(timer);
    // Final frame with the collapsed roster + footer.
    region.done(toLines(model, Date.now(), { footer: true }));
    process.exit(0);
  }
}, TICK_MS);

process.on('SIGINT', () => {
  clearInterval(timer);
  region.done();
  process.exit(130);
});
