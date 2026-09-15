/**
 * @fileoverview A hand-rolled, dependency-free live terminal region.
 *
 * Repaints a fixed block of lines in place (the develop two-tier tree), like
 * `log-update` — but the toolkit ships zero runtime deps, so the cursor math,
 * the dirty-check, and the width truncation all live here.
 *
 * The one invariant that keeps the cursor honest: **one logical line must occupy
 * exactly one screen row.** A line wider than the terminal wraps, which makes the
 * `\x1b[<N>A` cursor-up under-count and the block walks down the screen. So every
 * painted line is truncated to `columns - 1` before it is written — truncation is
 * load-bearing, not cosmetic.
 *
 * Non-TTY (CI, pipes) degrades to append-only: only newly-appeared lines are
 * printed once, no cursor codes, so logs stay clean — mirroring the heart
 * spinner's existing TTY guard.
 *
 * @module shared/live-region
 */

const { SHOW_CURSOR, HIDE_CURSOR } = require('./palette');
const { truncateToWidth } = require('./ansi-width');

const CURSOR_UP = (n) => `\x1b[${n}A`;
const CLEAR_TO_END = '\x1b[0J'; // erase from cursor to end of screen

/**
 * @typedef {object} LiveRegion
 * @property {(lines: string[]) => void} render - Repaint the block.
 * @property {(persist?: string[]) => void} done - Final paint + release the
 *   region (newline + show cursor) so later output appends below.
 * @property {boolean} isTTY
 */

/**
 * Creates a live region bound to a writable stream.
 *
 * @param {object} [opts]
 * @param {NodeJS.WriteStream} [opts.stream=process.stdout]
 * @returns {LiveRegion}
 */
function createLiveRegion({ stream = process.stdout } = {}) {
  const isTTY = Boolean(stream.isTTY);

  // TTY state.
  let prevCount = 0; // rows the last block occupied
  let lastBlock = null; // last rendered block string (dirty-check)
  let hidden = false; // did we hide the cursor?
  let released = false; // has done() run?

  // Non-TTY state: how many lines we've already emitted (append-only).
  let emitted = 0;

  const showCursor = () => {
    if (hidden) {
      stream.write(SHOW_CURSOR);
      hidden = false;
    }
  };

  // A resize changes the wrap width; invalidate the cache so the next render
  // repaints at the new column count instead of trusting a stale block.
  const onResize = () => {
    lastBlock = null;
  };
  if (isTTY) stream.on('resize', onResize);

  // Restore the cursor if the process dies mid-paint.
  const restore = () => showCursor();
  process.once('exit', restore);

  function renderTTY(lines) {
    const cols = stream.columns || 80;
    const block = lines.map((l) => truncateToWidth(l, cols - 1)).join('\n');
    if (block === lastBlock) return; // nothing changed — skip the write (no flicker)

    if (!hidden) {
      stream.write(HIDE_CURSOR);
      hidden = true;
    }

    let out = '';
    if (prevCount > 0) out += CURSOR_UP(prevCount);
    out += CLEAR_TO_END + block; // no trailing newline: cursor rests on the last row
    stream.write(out);

    prevCount = lines.length;
    lastBlock = block;
  }

  function renderNonTTY(lines) {
    // Append-only: print any lines beyond what we've already emitted. The tree
    // view appends settled lines in order, so this yields a clean transcript.
    for (let i = emitted; i < lines.length; i++) {
      stream.write(`${lines[i]}\n`);
    }
    emitted = lines.length;
  }

  return {
    isTTY,

    render(lines) {
      if (released) return;
      if (isTTY) renderTTY(lines);
      else renderNonTTY(lines);
    },

    done(persist) {
      if (released) return;
      released = true;
      if (isTTY) {
        if (persist) renderTTY(persist);
        stream.write('\n'); // move off the block's last row
        showCursor();
        stream.removeListener('resize', onResize);
      } else if (persist) {
        renderNonTTY(persist);
      }
    },
  };
}

module.exports = { createLiveRegion };
