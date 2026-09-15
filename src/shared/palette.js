/**
 * @fileoverview The shared terminal palette + cursor control codes.
 *
 * Extracted from `heart-spinner.js` so the sequential heart spinner and the
 * concurrent live-region renderer (develop's two-tier tree) draw from ONE
 * definition of the brand colors and the cursor escapes — never a fork. Pure
 * data + a `paint()` helper; no animation, no process state.
 *
 * @module shared/palette
 */

const HEART = '♥'; // U+2665 — takes ANSI color (unlike the emoji ❤).

// nice brand palette as truecolor RGB — a cool teal → cyan → blue → violet →
// pink cycle. Index order is the animation order.
const BRAND = [
  [110, 249, 194], // #6ef9c2
  [7, 231, 231], //   #07e7e7
  [21, 184, 255], //  #15b8ff
  [125, 125, 255], // #7d7dff
  [186, 145, 250], // #ba91fa
  [255, 175, 220], // #ffafdc
];

/**
 * Wraps `s` in a truecolor SGR for the given RGB triple, resetting after.
 * @param {[number, number, number]} rgb
 * @param {string} s
 * @returns {string}
 */
const paint = ([r, g, b], s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;

const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';
const CLEAR_LINE = '\r\x1b[K';

module.exports = {
  HEART,
  BRAND,
  paint,
  SHOW_CURSOR,
  HIDE_CURSOR,
  CLEAR_LINE,
};
