/**
 * @fileoverview Renders the develop tree model to a block of lines.
 *
 * Pure: `toLines(model, now)` derives every animated glyph from wall-clock time
 * so the animation resyncs after an event-loop stall (no incremented counter to
 * drift). Tier 1 = one line per package (heart spinner while reloading, else a
 * settled glyph via the shared `formatOutcome`). Tier 2 = the active package's
 * sub-items, indented two spaces, braille-spinning while in flight.
 *
 * @module cli/develop/tree-view
 */

const { formatOutcome, glyphFor } = require('../../shared/tasks/status');
const { HEART, BRAND, paint } = require('../../shared/palette');
const { DOT_FRAMES, FRAME_MS } = require('../../shared/dot-frames');
const { gray, yellow, red } = require('../../shared/logger');

const HEART_MS = 120; // heart color cadence (independent of the 80ms braille tick)

/** The animated braille glyph for the current instant. */
const dotGlyph = (now) => DOT_FRAMES[Math.floor(now / FRAME_MS) % DOT_FRAMES.length];

/** The heart, colored by the current instant. */
const heartGlyph = (now) => paint(BRAND[Math.floor(now / HEART_MS) % BRAND.length], HEART);

/**
 * Renders one active package's sub-item into 1–2 lines.
 * @param {import('./tree-model').SubItem} s
 * @param {number} now
 * @returns {string[]}
 */
function subLines(s, now) {
  let glyph;
  switch (s.state) {
    case 'active': glyph = gray(dotGlyph(now)); break;
    case 'warning': glyph = yellow('⚠'); break;
    case 'failed': glyph = red('✗'); break;
    default: glyph = gray('✓');
  }
  const lines = [`  ${glyph} ${s.text}`];
  if (s.detail) lines.push(`    ${gray(s.detail)}`);
  return lines;
}

/**
 * Builds the full line block for the current model state.
 *
 * @param {ReturnType<import('./tree-model').createTreeModel>} model
 * @param {number} now - Elapsed clock (ms); wall time in prod, fixture time in demo.
 * @param {object} [opts]
 * @param {boolean} [opts.footer=false] - Append the `Watching for changes…` footer.
 * @returns {string[]}
 */
function toLines(model, now, { footer = false } = {}) {
  const lines = [];

  for (const e of model.all()) {
    if (e.state === 'reloading' || e.state === 'settling') {
      lines.push(`${heartGlyph(now)} Reloading ${e.name}`);
      for (const s of e.subItems) lines.push(...subLines(s, now));
    } else if (e.state === 'settled' && e.outcome) {
      lines.push(formatOutcome(`Reloaded ${e.name}`, e.outcome));
    }
    // idle packages are not shown until their first reload.
  }

  if (footer) {
    lines.push('');
    lines.push(gray('Watching for changes…'));
  }
  return lines;
}

module.exports = { toLines, heartGlyph, dotGlyph, glyphFor };
