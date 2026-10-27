/**
 * The develop view's reading of real watcher output: parser → cycle tracker → lifecycle → tree
 * model → tree view, the same path dev-runner drives. Fixtures are captured `nicely develop`
 * output (rollup with TypeScript warnings, a failing tsc, storybook-navigation's TS2307 DTS
 * failure from 2026-10-08).
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createParser, strip } = require("../src/cli/develop/dev-output-parser")
const { createCycleTracker } = require("../src/cli/develop/cycle-tracker")
const { feedEvents } = require("../src/cli/develop/lifecycle")
const { createTreeModel } = require("../src/cli/develop/tree-model")
const { toLines } = require("../src/cli/develop/tree-view")
const { createDevelopView } = require("../src/cli/develop/develop-view")

// ── Fixtures ────────────────────────────────────────────────────────────────

const rollupOk = (name) => [
  `> ${name}@1.0.0 dev`,
  "> rollup -c -w",
  "rollup v4.60.2",
  "bundles src/index.ts → dist/index.js, dist/index.esm.js...",
  "created dist/index.js, dist/index.esm.js in 12.5s",
  "bundles dist/types/index.d.ts → dist/index.d.ts...",
  "created dist/index.d.ts in 265ms",
  "[2026-07-28 10:41:31] waiting for changes...",
]

const ROLLUP_WARN = [
  "> nice-react-button@1.0.0 dev",
  "> rollup -c -w",
  "bundles src/index.ts → dist/index.js, dist/index.esm.js...",
  "(!) [plugin typescript] src/components/Button/Button.tsx (43:31): @rollup/plugin-typescript TS2345: Argument of type 'string' is not assignable to parameter of type 'ButtonStatusType'.",
  "/Users/mohammedibrahim/nice/react-button/src/components/Button/Button.tsx:43:31",
  "",
  "43   const disabled = isDisabled(status)",
  "                                 ~~~~~~",
  "",
  "created dist/index.js, dist/index.esm.js in 17.8s",
  "[2026-07-28 10:41:31] waiting for changes...",
]

const TSC_FAIL = [
  "10:41:09 AM - Starting compilation in watch mode...",
  "src/index.ts(3,10): error TS2307: Cannot find module './missing'.",
  "10:41:12 AM - Found 1 errors. Watching for file changes.",
]

// storybook-navigation's cold start under the old runner (before.log, 2026-10-08)
const NAV_TS2307 = [
  "CLI Building entry: src/index.ts, src/manager.tsx, src/preview.tsx",
  "CLI Running in watch mode",
  "ESM Build start",
  "ESM dist/index.js              661.00 B",
  "ESM ⚡️ Build success in 512ms",
  'CLI Watching for changes in "."',
  "DTS Build start",
  "src/components/StoryNavigation.tsx(9,18): error TS2307: Cannot find module 'nice-react-flex' or its corresponding type declarations.",
  "src/components/StoryNavigation.tsx(10,17): error TS2307: Cannot find module 'nice-react-ink' or its corresponding type declarations.",
  "DTS Build failed",
  "Error: error occurred in dts build",
  "    at Worker.<anonymous> (/Users/mohammedibrahim/nice/storybook-navigation/node_modules/tsup/dist/index.js:1545:26)",
  "RollupError: [plugin dts] src/components/StoryNavigation.tsx: Failed to compile. Check the logs above.",
]

// ── Harness ─────────────────────────────────────────────────────────────────

/** Drives one package through the production path, with a manual clock and quiet timer. */
function harness(names) {
  let time = 1000
  const now = () => time
  const model = createTreeModel(now)
  const packages = new Map()
  for (const name of names) {
    model.register(name)
    let pending = null
    packages.set(name, {
      parser: createParser(name),
      tracker: createCycleTracker({
        onCycle: (outcome) => model.settle(name, outcome, { exitCode: packages.get(name).exitCode, outputBytes: packages.get(name).outputBytes }),
        setTimer: (fn) => (pending = fn),
        clearTimer: () => (pending = null),
      }),
      quiet: () => pending && pending(),
      exitCode: null,
      outputBytes: 49_459,
    })
  }
  const start = (name) => model.cycleStart(name)
  const feed = (name, lines) => {
    const pkg = packages.get(name)
    for (const line of lines) {
      time += 100
      const events = pkg.parser.feed(line)
      feedEvents(model, name, line, events)
      pkg.tracker.feed(events)
    }
  }
  const exit = (name, code) => {
    packages.get(name).exitCode = code
    packages.get(name).tracker.exit()
  }
  const quiet = (name) => packages.get(name).quiet()
  const lines = (rows) => toLines(model, time, { rows }).map(strip)
  return { model, packages, start, feed, exit, quiet, lines }
}

// ── Parser ──────────────────────────────────────────────────────────────────

test("parser: a rollup cycle is build steps, finished steps, then the idle line; npm and banner noise drop", () => {
  const parser = createParser("nice-react-icon")
  const types = rollupOk("nice-react-icon").flatMap((line) => parser.feed(line).map((event) => event.type))
  assert.deepEqual(types, ["build-start", "sub", "build-start", "sub", "cycle-end"])
})

test("parser: a rollup warning and its code frame become one warning with the file as detail", () => {
  const parser = createParser("nice-react-button")
  const events = ROLLUP_WARN.flatMap((line) => parser.feed(line))
  const warnings = events.filter((event) => event.type === "warning")
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].text, /TS2345/)
  assert.equal(warnings[0].detail, "/Users/mohammedibrahim/nice/react-button/src/components/Button/Button.tsx:43:31")
})

test("parser: error markers — rollup [!] and RollupError, tsup Build failed, error TS", () => {
  const parser = createParser("x")
  for (const line of ["[!] Error: Could not resolve './x'", "RollupError: something", "DTS Build failed", "src/a.tsx(9,18): error TS2307: Cannot find module 'y'"]) {
    assert.deepEqual(parser.feed(line).map((event) => event.type), ["error"], line)
  }
})

// ── Model and view ──────────────────────────────────────────────────────────

test("a clean rollup cycle settles ✓ with its duration and dist size", () => {
  const h = harness(["nice-react-icon"])
  h.start("nice-react-icon")
  h.feed("nice-react-icon", rollupOk("nice-react-icon"))
  assert.equal(h.model.get("nice-react-icon").state, "settled")
  assert.match(h.lines()[1], /^  ✓ react-icon {2}0\.\ds · 48\.3 KB$/)
})

test("sizes read in B, KB and MB; a package without dist/ shows its duration only", () => {
  const h = harness(["nice-a", "nice-b", "nice-c", "nice-d"])
  const sizes = { "nice-a": 512, "nice-b": 49_459, "nice-c": 3_250_586, "nice-d": null }
  for (const [name, bytes] of Object.entries(sizes)) {
    h.packages.get(name).outputBytes = bytes
    h.start(name)
    h.feed(name, rollupOk(name))
  }
  const rows = h.lines().slice(1, 5)
  assert.match(rows[0], / 0\.\ds · 512 B$/)
  assert.match(rows[1], / 0\.\ds · 48\.3 KB$/)
  assert.match(rows[2], / 0\.\ds · 3\.1 MB$/)
  assert.match(rows[3], /  0\.\ds$/)
})

test("a warning settles ⚠ with its count", () => {
  const h = harness(["nice-react-button"])
  h.start("nice-react-button")
  h.feed("nice-react-button", ROLLUP_WARN)
  assert.match(h.lines()[1], /^  ⚠ react-button {2}1 warning · /)
})

test("storybook-navigation's TS2307 DTS failure: ✗ row and the diagnostics pinned under the tree", () => {
  const h = harness(["nice-storybook-navigation"])
  h.start("nice-storybook-navigation")
  h.feed("nice-storybook-navigation", NAV_TS2307)
  h.quiet("nice-storybook-navigation")
  const lines = h.lines()
  assert.match(lines[1], /^  ✗ storybook-navigation {2}src\/components\/StoryNavigation\.tsx\(9,18\): error TS2307/)
  const pinned = lines.slice(lines.indexOf("✗ nice-storybook-navigation"))
  assert.ok(pinned.length > 1, "diagnostics are pinned")
  assert.ok(pinned.some((line) => line.includes("Cannot find module 'nice-react-flex'")))
  assert.ok(pinned.some((line) => line.includes("Cannot find module 'nice-react-ink'")))
  assert.ok(pinned.some((line) => line.includes("DTS Build failed")))
  assert.ok(!pinned.some((line) => line.includes("at Worker.<anonymous>")), "stack frames are not pinned")
})

test("pinned diagnostics stay until the package's next successful cycle", () => {
  const h = harness(["nice-styles"])
  h.start("nice-styles")
  h.feed("nice-styles", TSC_FAIL)
  assert.ok(h.model.get("nice-styles").pinned.some((line) => line.includes("error TS2307")))
  h.feed("nice-styles", ["10:42:00 AM - File change detected. Starting incremental compilation...", "10:42:01 AM - Found 0 errors. Watching for file changes."])
  assert.equal(h.model.get("nice-styles").pinned, null)
  assert.match(h.lines()[1], /^  ✓ styles/)
})

test("an unexpected watcher exit is a ✗ row with the exit code and its last lines pinned", () => {
  const h = harness(["nice-react-flex"])
  h.start("nice-react-flex")
  h.feed("nice-react-flex", ["> nice-react-flex@7.0.1 dev", "npm ERR! code ELIFECYCLE"])
  h.exit("nice-react-flex", 1)
  const lines = h.lines()
  assert.equal(lines[1], "  ✗ react-flex  Exited with code 1")
  assert.ok(lines.includes("  npm ERR! code ELIFECYCLE"))
})

test("condensed: a building row carries its newest step, with no step lines under it", () => {
  const h = harness(["nice-react-styles", "nice-react-ink"])
  h.model.get("nice-react-ink").deps = new Set(["nice-react-styles"])
  h.start("nice-react-styles")
  h.feed("nice-react-styles", ["bundles src/index.ts → dist/index.js, dist/index.esm.js..."])
  let lines = h.lines()
  assert.match(lines[0], /2 packages · 1 building · 1\/2 started/)
  assert.match(lines[1], /^  ♥ react-styles {2}0\.1s · \S Bundling JavaScript$/, "elapsed since the cycle started, then the newest step")
  assert.equal(lines.length, 3, "no step lines under the row")
  assert.match(lines[2], /^  · react-ink {5}Waiting for react-styles$/)
  h.feed("nice-react-styles", ["created dist/index.js, dist/index.esm.js in 1.1s"])
  lines = h.lines()
  assert.match(lines[1], /^  ♥ react-styles {2}0\.2s · \S Bundled JavaScript$/)
})

test("build time and size turn yellow over 8s / 512 KB and red over 20s / 2 MB", () => {
  const YELLOW = "\x1b[33m"
  const RED = "\x1b[31m"
  const GRAY = "\x1b[90m"
  const model = createTreeModel(() => 0)
  const rows = [
    ["nice-a", 8_000, 512 * 1024, GRAY, GRAY],
    ["nice-b", 8_100, 512 * 1024 + 1, YELLOW, YELLOW],
    ["nice-c", 20_100, 2 * 1024 * 1024 + 1, RED, RED],
  ]
  for (const [name, duration, bytes] of rows) {
    model.register(name)
    model.cycleStart(name)
    model.settle(name, "ready", { outputBytes: bytes })
    Object.assign(model.get(name), { duration })
  }
  const lines = toLines(model, 0, { rows: 20 }).slice(1)
  rows.forEach(([, duration, , timeColor, sizeColor], i) => {
    assert.ok(lines[i].includes(`${timeColor}${(duration / 1000).toFixed(1)}s`), lines[i])
    assert.match(lines[i], new RegExp(`\\x1b\\[${sizeColor.slice(2)}[\\d.]+ (KB|MB)`))
  })
})

test("a building row's time is white while it counts, then yellow over 8s and red over 20s", () => {
  const model = createTreeModel(() => 0)
  model.register("nice-a")
  model.cycleStart("nice-a")
  const timeAt = (ms) => toLines(model, ms, { rows: 20 })[1]
  assert.ok(timeAt(8_000).includes("\x1b[97m8.0s"), "white up to the limit")
  assert.ok(timeAt(8_100).includes("\x1b[33m8.1s"), "yellow once past 8s, while still building")
  assert.ok(timeAt(20_100).includes("\x1b[31m20.1s"), "red once past 20s")
})

test("a queued row names its first blocker and counts the rest", () => {
  const h = harness(["nice-react-styles", "nice-react-flex", "nice-react-ink", "nice-react-button", "nice-react-list"])
  h.model.get("nice-react-flex").deps = new Set(["nice-react-styles"])
  h.model.get("nice-react-ink").deps = new Set(["nice-react-styles", "nice-react-flex"])
  h.model.get("nice-react-button").deps = new Set(["nice-react-styles", "nice-react-flex", "nice-react-ink"])
  const rows = h.lines().slice(1)
  assert.match(rows[1], /Waiting for react-styles$/)
  assert.match(rows[2], /Waiting for react-styles, and 1 other$/)
  assert.match(rows[3], /Waiting for react-styles, and 2 others$/)
  assert.match(rows[4], /Queued$/)
})

test("verbose: building packages list every step; finished ones leave the tree", () => {
  const h = harness(["nice-react-styles", "nice-react-flex"])
  h.start("nice-react-styles")
  h.start("nice-react-flex")
  h.feed("nice-react-styles", rollupOk("nice-react-styles"))
  h.feed("nice-react-flex", ["bundles src/index.ts → dist/index.js, dist/index.esm.js...", "created dist/index.js, dist/index.esm.js in 2.0s"])
  const lines = toLines(h.model, 5000, { verbose: true }).map(strip)
  assert.ok(!lines.some((line) => line.includes("react-styles")), "the finished package is not in the tree")
  assert.match(lines[1], /^  ♥ react-flex {4}\d+\.\ds · Building$/)
  assert.match(lines[2], /^      ✓ Bundling JavaScript$/)
  assert.match(lines[3], /^      \S Bundled JavaScript$/)
  // Squeezed to fit, the tree still leaves finished packages to the scrollback
  assert.ok(!toLines(h.model, 5000, { verbose: true, rows: 3 }).map(strip).some((line) => line.includes("ready")))
})

test("the header counts reloads and switches to 'all built once' at the end of startup", () => {
  const h = harness(["nice-react-icon"])
  h.start("nice-react-icon")
  h.feed("nice-react-icon", rollupOk("nice-react-icon"))
  h.model.allBuilt(12400)
  h.model.reloadPing("nice-react-icon")
  h.model.reloadPing("nice-react-icon")
  const [header, reloads] = h.lines()
  assert.match(header, /all built once in 12\.4s$/)
  assert.equal(reloads, "  2 reloads · last 0s ago (react-icon)")
})

test("the block fits the terminal: ready rows collapse, then pinned diagnostics are cut", () => {
  const names = Array.from({ length: 12 }, (_, i) => `nice-pkg-${i}`)
  const h = harness([...names, "nice-storybook-navigation"])
  for (const name of names) {
    h.start(name)
    h.feed(name, rollupOk(name))
  }
  h.start("nice-storybook-navigation")
  h.feed("nice-storybook-navigation", NAV_TS2307)
  h.quiet("nice-storybook-navigation")
  const lines = h.lines(9)
  assert.ok(lines.length <= 8)
  assert.ok(lines.includes("  ✓ 12 ready"))
  assert.match(lines[lines.length - 1], /more lines \(nicely develop --raw prints everything\)/)
})

// ── Non-TTY ─────────────────────────────────────────────────────────────────

test("non-TTY: one line per state change, a failure's diagnostics in full", () => {
  const written = []
  const stream = { isTTY: false, write: (text) => written.push(text) }
  const view = createDevelopView({ stream, settleMs: 0 })
  const graph = new Map([["nice-storybook-navigation", new Set()]])
  view.begin(graph, ["nice-storybook-navigation"])
  view.starting(["nice-storybook-navigation"], [])
  const parser = createParser("nice-storybook-navigation")
  for (const line of NAV_TS2307) view.output("nice-storybook-navigation", line, parser.feed(line))
  view.cycle("nice-storybook-navigation", "failed", { exitCode: null })
  view.reloadPing("nice-storybook-navigation", 3)
  view.done()
  const out = strip(written.join("")).split("\n").filter(Boolean)
  assert.equal(out[0], "♥ Starting storybook-navigation")
  assert.match(out[1], /^✗ storybook-navigation {2}src\/components\/StoryNavigation\.tsx\(9,18\): error TS2307/)
  assert.ok(out.includes("    DTS Build failed"))
  assert.equal(out[out.length - 1], "Reloaded storybook-navigation (3 files)")
})

test("rollup's declaration rerun right after a build settles once, as part of the same build", async () => {
  const written = []
  const stream = { isTTY: false, write: (text) => written.push(text) }
  const view = createDevelopView({ stream, settleMs: 50 })
  view.begin(new Map([["nice-react-slider", new Set()]]), ["nice-react-slider"])
  view.starting(["nice-react-slider"], [])
  const parser = createParser("nice-react-slider")
  const feed = (lines) => lines.forEach((line) => view.output("nice-react-slider", line, parser.feed(line)))
  feed(rollupOk("nice-react-slider"))
  view.cycle("nice-react-slider", "ready", { exitCode: null })
  // The rerun captured on 2026-10-08, 150ms after the first "waiting for changes"
  feed(["bundles dist/types/index.d.ts → dist/index.d.ts...", "created dist/index.d.ts in 26ms", "[2026-10-08 17:36:51] waiting for changes..."])
  view.cycle("nice-react-slider", "ready", { exitCode: null })
  await new Promise((resolve) => setTimeout(resolve, 100))
  view.done()
  const settled = strip(written.join("")).split("\n").filter((line) => line.startsWith("✓"))
  assert.equal(settled.length, 1)
})

test("'all built once' comes after the last package's own line, even inside its settle window", () => {
  const written = []
  const stream = { isTTY: false, write: (text) => written.push(text) }
  const view = createDevelopView({ stream, settleMs: 10000 })
  view.begin(new Map([["nice-react-flex", new Set()]]), ["nice-react-flex"])
  view.starting(["nice-react-flex"], [])
  view.cycle("nice-react-flex", "ready", { exitCode: null })
  view.allBuilt(1, 5000)
  view.done()
  const out = strip(written.join("")).split("\n").filter(Boolean)
  assert.match(out[1], /^✓ react-flex {2}Built in/)
  assert.equal(out[2], "✓ All 1 packages built once in 5.0s")
})
