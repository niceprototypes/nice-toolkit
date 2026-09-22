/**
 * @fileoverview The buildable icon set for `nicely build` icon targets.
 *
 * Provides the candidate names that icon targets (`carat-*`, `carat-bottom`) are
 * matched against — the folder names under nice-icons' `src/icons/source/` (each holds
 * the `.ai` sources `--convert` turns into SVGs). The generic token→name matcher
 * lives in `args/select.js` (`expandTargets`); this only supplies the candidates.
 *
 * @module linking/icon-targets
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { readRegistry } = require('../shared/registry/read');

/** Absolute path to nice-icons' `src/icons/source` (the buildable icon tree). */
function iconSourceDir() {
  const base = readRegistry().basePath.replace('~', os.homedir());
  return path.join(base, 'icons', 'src', 'icons', 'source');
}

/**
 * The buildable icon names — every folder under nice-icons' `src/icons/source`.
 *
 * @returns {string[]} Icon folder names (empty if the tree is absent).
 */
function listIconNames() {
  const dir = iconSourceDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

module.exports = { listIconNames };
