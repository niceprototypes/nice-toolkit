/**
 * @fileoverview ANSI-aware visible width + truncation, hand-rolled.
 *
 * The toolkit ships zero runtime deps, so `string-width` / `cli-truncate` are
 * off the table. The live region needs exactly two things: the visible column
 * width of a styled string (SGR escapes cost nothing; wide CJK/emoji cost two),
 * and a truncation that never severs an escape mid-sequence. These are the
 * minimum viable versions — the `columns - 1` render margin absorbs any residual
 * width error so a mistake stays cosmetic, never breaks the cursor math.
 *
 * @module shared/ansi-width
 */

// Matches a CSI SGR/cursor sequence (`\x1b[ ... m`, `\x1b[ ... K`, etc.).
const CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const RESET = '\x1b[0m';

/**
 * True for code points that occupy two terminal cells (CJK, most emoji). A
 * conservative range set — not exhaustive, but covers the common cases; the
 * render margin covers the rest.
 * @param {number} cp - Code point.
 * @returns {boolean}
 */
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B+
  );
}

/**
 * Visible column width of `str`, ignoring ANSI escape sequences.
 * @param {string} str
 * @returns {number}
 */
function visibleWidth(str) {
  const plain = String(str).replace(CSI, '');
  let width = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x200d || cp === 0xfe0f) continue; // ZWJ / VS16 — zero width
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/**
 * Truncate `str` to at most `max` visible columns, preserving ANSI escapes
 * (they cost no width and are copied through) and never cutting one in half. If
 * truncation happens, a trailing reset is appended so color can't bleed.
 *
 * @param {string} str
 * @param {number} max - Maximum visible width.
 * @returns {string}
 */
function truncateToWidth(str, max) {
  if (max <= 0) return '';
  const s = String(str);
  if (visibleWidth(s) <= max) return s;

  let out = '';
  let width = 0;
  let i = 0;
  while (i < s.length) {
    // Copy an escape sequence verbatim, no width.
    if (s[i] === '\x1b') {
      CSI.lastIndex = i;
      const m = CSI.exec(s);
      if (m && m.index === i) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const w = cp === 0x200d || cp === 0xfe0f ? 0 : isWide(cp) ? 2 : 1;
    if (width + w > max) break;
    out += ch;
    width += w;
    i += ch.length;
  }
  return out + RESET;
}

module.exports = { visibleWidth, truncateToWidth };
