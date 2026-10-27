/**
 * The live region repaints its block in place: replayed on a minimal terminal (\r, \n, cursor
 * up, clear to end of screen; styling codes ignored), lines printed before the region survive any
 * number of repaints, and each repaint starts at the block's first row, column 0.
 *
 * Regression: the repaint moved up one row too many and kept the cursor's column, so each frame
 * started a row higher (erasing a line above) and the first row began where the last one ended.
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createLiveRegion } = require("../src/shared/live-region")

/** A terminal screen that applies the escape sequences the live region writes. */
function terminal() {
  const rows = [""]
  let row = 0
  let col = 0
  const put = (char) => {
    const line = rows[row].padEnd(col)
    rows[row] = line.slice(0, col) + char + line.slice(col + 1)
    col += 1
  }
  const stream = {
    isTTY: true,
    columns: 200,
    rows: 50,
    on() {},
    removeListener() {},
    write(text) {
      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === "\x1b") {
          const match = text.slice(i).match(/^\x1b\[([0-9;?]*)([A-Za-z])/)
          const [sequence, arg, code] = match
          if (code === "A") row = Math.max(0, row - Number(arg || 1))
          if (code === "J") {
            rows.splice(row + 1)
            rows[row] = rows[row].slice(0, col)
          }
          i += sequence.length - 1
        } else if (char === "\r") {
          col = 0
        } else if (char === "\n") {
          row += 1
          col = 0
          if (rows.length <= row) rows.push("")
        } else {
          put(char)
        }
      }
    },
  }
  return { stream, screen: () => rows.map((line) => line.trimEnd()) }
}

test("repaints keep the lines above the region and start at the block's first row, column 0", () => {
  const { stream, screen } = terminal()
  stream.write("ℹ Detected package manager: npm\nℹ Skipping nice-icons (no dist/ folder)\n")
  const region = createLiveRegion({ stream })
  region.render(["♥ nicely develop  3 packages", "· react-flex  waiting for react-styles", "· react-ink  waiting for react-styles"])
  region.render(["♥ nicely develop  3 packages · 1 building", "♥ react-flex  building 0.4s", "    ⠋ bundles src/index.ts → dist/index.js..."])
  region.render(["♥ nicely develop  3 packages · all built once in 4.1s", "✓ react-flex  4.1s"])
  region.render(["♥ nicely develop  3 packages · all built once in 4.1s", "✓ react-flex  4.1s", "✓ react-ink  3.9s", "  2 reloads"])
  assert.deepEqual(screen(), [
    "ℹ Detected package manager: npm",
    "ℹ Skipping nice-icons (no dist/ folder)",
    "♥ nicely develop  3 packages · all built once in 4.1s",
    "✓ react-flex  4.1s",
    "✓ react-ink  3.9s",
    "  2 reloads",
  ])
  region.done()
  stream.write("ℹ Stopped all dev processes\n")
  assert.equal(screen()[6], "ℹ Stopped all dev processes")
})

test("a one-line block repaints in place", () => {
  const { stream, screen } = terminal()
  stream.write("before\n")
  const region = createLiveRegion({ stream })
  region.render(["♥ one"])
  region.render(["♥ two"])
  region.render(["♥ three"])
  assert.deepEqual(screen(), ["before", "♥ three"])
})

test("printAbove leaves its lines in the scrollback and draws the block again below them", () => {
  const { stream, screen } = terminal()
  stream.write("ℹ Detected package manager: npm\n")
  const region = createLiveRegion({ stream })
  region.render(["♥ nicely develop  2 packages · 2 building", "  ♥ react-styles  building 0.4s", "  ♥ react-flex  building 0.4s"])
  region.printAbove(["  ✓ react-styles  1.2s · 48.3 KB", "      ✓ bundles src/index.ts → dist/index.js...", "      ✓ created dist/index.js in 1.1s"])
  region.render(["♥ nicely develop  2 packages · 1 building", "  ♥ react-flex  building 1.3s"])
  region.render(["♥ nicely develop  2 packages · 1 building", "  ♥ react-flex  building 1.4s", "      ⠋ bundles src/index.ts → dist/index.js..."])
  region.printAbove(["  ✓ react-flex  1.5s · 31.0 KB"])
  region.render(["♥ nicely develop  2 packages · all built once in 1.5s"])
  assert.deepEqual(screen(), [
    "ℹ Detected package manager: npm",
    "  ✓ react-styles  1.2s · 48.3 KB",
    "      ✓ bundles src/index.ts → dist/index.js...",
    "      ✓ created dist/index.js in 1.1s",
    "  ✓ react-flex  1.5s · 31.0 KB",
    "♥ nicely develop  2 packages · all built once in 1.5s",
  ])
})
