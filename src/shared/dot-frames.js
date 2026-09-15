/**
 * @fileoverview Braille dot-spinner frames for the live-region sub-items.
 *
 * Pure data. Unlike `heart-spinner.js` (which owns its own interval and animates
 * a single line with `\r`), these frames are consumed by the develop live region
 * that repaints the whole tree from ONE clock — so there is nothing to animate
 * here, just the frame set and its cadence. The renderer derives the current
 * frame from wall-clock elapsed so it resyncs after any event-loop stall.
 *
 * @module shared/dot-frames
 */

// The classic 10-frame braille spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏).
const DOT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const FRAME_MS = 80;

/**
 * The braille glyph for a given elapsed time, at the 80ms cadence.
 * @param {number} elapsedMs - Milliseconds since the spinner started.
 * @returns {string}
 */
const dotFor = (elapsedMs) => DOT_FRAMES[Math.floor(elapsedMs / FRAME_MS) % DOT_FRAMES.length];

module.exports = { DOT_FRAMES, FRAME_MS, dotFor };
