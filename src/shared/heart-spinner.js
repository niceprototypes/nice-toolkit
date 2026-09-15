/**
 * @fileoverview A heartbeat spinner for long build waits.
 *
 * Renders a single UTF heart on one line, cycling through the nice brand palette
 * (a cool teal → cyan → blue → violet gradient), animated on an interval at
 * FRAME_MS. Because it runs while a build is `await`ed (the child
 * is spawned async, not spawnSync), the event loop is free to tick it — the same
 * reason a spinner works during any async wait.
 *
 * TTY-only: on a non-interactive stdout (CI, pipes) it degrades to a single
 * static line and no animation, so logs stay clean.
 *
 * @module shared/heart-spinner
 */

const { HEART, BRAND, paint, SHOW_CURSOR, HIDE_CURSOR, CLEAR_LINE } = require('./palette');

const FRAME_MS = 120;

// Restore the cursor if we're killed mid-spin (otherwise it stays hidden).
let active = 0;
const restore = () => {
  if (active > 0) {
    process.stdout.write(SHOW_CURSOR);
    active = 0;
  }
};
process.once('exit', restore);
process.once('SIGINT', () => {
  restore();
  process.exit(130);
});

/**
 * Start the heartbeat next to `label`. The label is the full phrase (verb
 * included) so callers own the wording — e.g. "Building nice-icons",
 * "Scanning packages". Returns a `stop(finalLine)` that clears the animation
 * and prints `finalLine` (the persistent done/failed line).
 *
 * @param {string} label - Full phrase (rendered as "♥ <label>…")
 * @returns {(finalLine?: string) => void} stop function
 */
function startHeartSpinner(label) {
  const stream = process.stdout;

  if (!stream.isTTY) {
    stream.write(`  ${HEART} ${label}…\n`);
    return (finalLine) => {
      if (finalLine) stream.write(`  ${finalLine}\n`);
    };
  }

  active++;
  stream.write(HIDE_CURSOR);
  let i = 0;
  const render = () => {
    stream.write(`${CLEAR_LINE}  ${paint(BRAND[i % BRAND.length], HEART)} ${label}…`);
    i++;
  };
  render();
  const id = setInterval(render, FRAME_MS);

  return (finalLine) => {
    clearInterval(id);
    stream.write(CLEAR_LINE + SHOW_CURSOR);
    active = Math.max(0, active - 1);
    if (finalLine) stream.write(`  ${finalLine}\n`);
  };
}

module.exports = { startHeartSpinner };
