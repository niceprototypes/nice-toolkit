const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createParser } = require("../src/cli/develop/dev-output-parser")
const { createCycleTracker } = require("../src/cli/develop/cycle-tracker")

/** A fresh parser and tracker with a manual clock; `quiet()` runs the pending quiet timer. */
function setup() {
  const outcomes = []
  let pending = null
  const parser = createParser("pkg")
  const tracker = createCycleTracker({
    onCycle: (result) => outcomes.push(result),
    setTimer: (fn) => (pending = fn),
    clearTimer: () => (pending = null),
  })
  const feed = (lines) => lines.forEach((line) => tracker.feed(parser.feed(line)))
  const quiet = () => pending && pending()
  return { outcomes, tracker, feed, quiet }
}

/** Feeds lines, then (optionally) the quiet window; returns the first cycle's outcome. */
function run(lines, { thenQuiet = true } = {}) {
  const { outcomes, tracker, feed, quiet } = setup()
  feed(lines)
  if (thenQuiet && outcomes.length === 0) quiet()
  return { outcome: outcomes[0] ?? null, tracker }
}

// Captured output, trimmed (rollup and tsc from `nicely develop`, tsup from storybook-navigation).
const ROLLUP = [
  "> nice-react-flex@7.0.1 dev",
  "> rollup -c -w",
  "rollup v4.60.2",
  "bundles src/index.ts → dist/index.js, dist/index.esm.js...",
  "created dist/index.js, dist/index.esm.js in 12.3s",
  "bundles dist/types/index.d.ts → dist/index.d.ts...",
  "created dist/index.d.ts in 410ms",
  "[2026-10-08 16:38:28] waiting for changes...",
]
const TSUP_HEAD = [
  "CLI Building entry: src/index.ts, src/manager.tsx, src/preview.tsx",
  "CLI Running in watch mode",
  "ESM Build start",
  "ESM dist/index.js              661.00 B",
  "ESM ⚡️ Build success in 196ms",
  'CLI Watching for changes in "."',
  "DTS Build start",
]

test("rollup: settles on 'waiting for changes'", () => {
  assert.equal(run(ROLLUP, { thenQuiet: false }).outcome, "ready")
})

test("tsc: settles on its idle line; errors mark the cycle failed", () => {
  assert.equal(run(["Starting compilation in watch mode...", "10:41:12 AM - Found 0 errors. Watching for file changes."], { thenQuiet: false }).outcome, "ready")
  // "Found 1 errors. Watching…" is an error plus the idle line: the first cycle settles, failed
  assert.equal(run(["Starting compilation in watch mode...", "src/a.ts(1,1): error TS2307: Cannot find module 'x'.", "10:41:12 AM - Found 1 errors. Watching for file changes."], { thenQuiet: false }).outcome, "failed")
})

test("tsup: does not settle between the ESM build and the late DTS start", () => {
  // ESM done, then quiet would end it — but the DTS start right after keeps it open
  const { outcome } = run(TSUP_HEAD)
  assert.equal(outcome, null)
})

test("tsup: settles after DTS succeeds and output goes quiet", () => {
  assert.equal(run([...TSUP_HEAD, "DTS ⚡️ Build success in 4210ms"]).outcome, "ready")
})

test("tsup: a failed DTS build settles as failed", () => {
  const lines = [...TSUP_HEAD, "src/components/StoryNavigation.tsx(9,18): error TS2307: Cannot find module 'nice-react-flex'", "DTS Build failed"]
  assert.equal(run(lines).outcome, "failed")
})

test("icons generator: a finished step then quiet settles", () => {
  assert.equal(run(["> nice-icons@4.0.0 dev", "✓ Generated icons index (83 icons)"]).outcome, "ready")
})

test("an exit ends the cycle as exited, once; later output is ignored", () => {
  const { outcomes, tracker, feed } = setup()
  feed(["> nice-x@1.0.0 dev"])
  assert.deepEqual(outcomes, [])
  tracker.exit()
  tracker.exit()
  feed(["bundles src/index.ts → dist/index.js...", "[2026-10-08 16:38:28] waiting for changes..."])
  assert.deepEqual(outcomes, ["exited"])
})

test("every rebuild is its own cycle: rollup rebuild fails, then the fix succeeds", () => {
  const { outcomes, feed } = setup()
  feed(ROLLUP)
  feed(["bundles src/index.ts → dist/index.js, dist/index.esm.js...", "[!] RollupError: src/index.ts (3:10): Expected ';'", "[2026-10-08 16:40:00] waiting for changes..."])
  feed(["bundles src/index.ts → dist/index.js, dist/index.esm.js...", "created dist/index.js, dist/index.esm.js in 1.2s", "[2026-10-08 16:41:00] waiting for changes..."])
  assert.deepEqual(outcomes, ["ready", "failed", "ready"])
})

test("after the first cycle, any output then quiet ends a cycle (tsup rebuild, generator logs)", () => {
  const { outcomes, feed, quiet } = setup()
  feed([...TSUP_HEAD, "DTS ⚡️ Build success in 4210ms"])
  quiet()
  feed(["Change detected: src/index.ts"])
  quiet()
  assert.deepEqual(outcomes, ["ready", "ready"])
})

test("the parser classifies rollup's and tsup's failure lines as errors", () => {
  const parser = createParser("x")
  for (const line of ["[!] Error: Could not resolve './x'", "RollupError: something", "DTS Build failed", "src/a.tsx(9,18): error TS2307: Cannot find module 'y'"]) {
    assert.deepEqual(parser.feed(line).map((event) => event.type), ["error"], line)
  }
})

// nice-styles' dev script: tsc --watch beside three generators, which finish within seconds while
// tsc is still compiling (captured order and wording, paths shortened).
const STYLES = [
  "[9:49:45 PM] Starting compilation in watch mode...",
  "✓ Themes module night tokens validated",
  "✓ Generated: /Users/x/nice/styles/src/generated/tokensData.ts",
  "Watching /Users/x/nice/styles/src/tokens for changes...",
  "✓ Generated TypeScript types: /Users/x/nice/styles/src/generated/types.ts",
  "✓ Generated: /Users/x/nice/styles/dist/tokens.css",
  "Watching /Users/x/nice/styles/src/tokens for changes...",
]

test("a tsc compile holds the cycle open while other watchers in the script go quiet", () => {
  const { outcomes, feed, quiet } = setup()
  feed(STYLES)
  quiet()
  assert.deepEqual(outcomes, [], "the generators' quiet does not end the cycle")
  feed(["[9:49:57 PM] Found 0 errors. Watching for file changes."])
  assert.deepEqual(outcomes, ["ready"], "tsc's idle line ends it, once")
  // A token edit: the generators run again, then tsc recompiles their output
  feed(["✓ Generated: /Users/x/nice/styles/src/generated/tokensData.ts", "[9:50:10 PM] File change detected. Starting incremental compilation..."])
  quiet()
  assert.deepEqual(outcomes, ["ready"])
  feed(["[9:50:11 PM] Found 0 errors. Watching for file changes."])
  assert.deepEqual(outcomes, ["ready", "ready"])
})
