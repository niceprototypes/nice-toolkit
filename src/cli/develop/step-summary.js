/**
 * @fileoverview Readable summaries of watcher steps for the develop tree.
 *
 * The build tools' fixed messages become short phrases ("bundles src/index.ts → dist/index.js,
 * dist/index.esm.js..." → "Bundling JavaScript"). Anything else keeps its own words, tidied: no
 * leading ✓, no timestamp, paths relative to the package, a capital first letter. Errors and
 * warnings are not summarized (they are diagnostics); `--raw` shows every original line.
 *
 * @module cli/develop/step-summary
 */

const FORMATS = { ESM: 'ESM', CJS: 'CommonJS', DTS: 'type declaration' };

/** First match wins. */
const SUMMARIES = [
  // rollup: the JS config, then the declaration bundle
  [/^bundles .*→ dist\/index\.d\.ts/, () => 'Bundling type declarations'],
  [/^bundles /, () => 'Bundling JavaScript'],
  [/^created dist\/index\.d\.ts/, () => 'Bundled type declarations'],
  [/^created /, () => 'Bundled JavaScript'],
  // tsup: per format
  [/^DTS Build start/, () => 'Building type declarations'],
  [/^DTS .*Build success/, () => 'Built type declarations'],
  [/^(ESM|CJS) Build start/, ([, format]) => `Building ${FORMATS[format]} bundle`],
  [/^(ESM|CJS) .*Build success/, ([, format]) => `Built ${FORMATS[format]} bundle`],
  [/^(ESM|CJS|DTS) dist\//, ([, format]) => `Writing ${FORMATS[format]} files`],
  [/^CLI Cleaning output folder/, () => 'Cleaning output folder'],
  // tsc --watch
  [/Starting compilation in watch mode|Starting incremental compilation/, () => 'Compiling TypeScript'],
  // a generator's own watch banner
  [/^Watching .*for (asset )?changes/, () => 'Watching for changes'],
];

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * @param {string} text - A step's text (an ANSI-free watcher line)
 * @returns {string}
 */
function summarizeStep(text) {
  for (const [pattern, summary] of SUMMARIES) {
    const match = text.match(pattern);
    if (match) return summary(match);
  }
  const tidied = text
    .replace(/^(✓\s*)+/, '') //                          generator check marks
    .replace(/^\[?\d{1,2}:\d\d:\d\d(\s?[AP]M)?\]?\s*-?\s*/, '') // tsc timestamps
    .replace(/\/\S*?\/nice\/[^/\s]+\//g, '') //           absolute paths, relative to the package
    .replace(/^Generated: /, 'Generated ');
  return capitalize(tidied);
}

module.exports = { summarizeStep };
