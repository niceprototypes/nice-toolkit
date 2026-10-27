/**
 * Step summaries, over the step texts captured from `nicely develop` on 2026-10-08.
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { summarizeStep } = require("../src/cli/develop/step-summary")
const { createParser } = require("../src/cli/develop/dev-output-parser")

test("the build tools' fixed messages become short phrases", () => {
  const cases = {
    "bundles src/index.ts → dist/index.js, dist/index.esm.js...": "Bundling JavaScript",
    "created dist/index.js, dist/index.esm.js in 1.4s": "Bundled JavaScript",
    "bundles dist/types/index.d.ts → dist/index.d.ts...": "Bundling type declarations",
    "created dist/index.d.ts in 79ms": "Bundled type declarations",
    "ESM Build start": "Building ESM bundle",
    "CJS Build start": "Building CommonJS bundle",
    "DTS Build start": "Building type declarations",
    "ESM ⚡️ Build success in 283ms": "Built ESM bundle",
    "CJS ⚡️ Build success in 120ms": "Built CommonJS bundle",
    "DTS ⚡️ Build success in 4210ms": "Built type declarations",
    "ESM dist/preview.js.map        1.84 KB": "Writing ESM files",
    "CJS dist/index.cjs 12.10 KB": "Writing CommonJS files",
    "CLI Cleaning output folder": "Cleaning output folder",
    "[5:36:40 PM] Starting compilation in watch mode...": "Compiling TypeScript",
    "10:42:00 AM - File change detected. Starting incremental compilation...": "Compiling TypeScript",
    "Watching /Users/mohammedibrahim/nice/styles/src/tokens for changes...": "Watching for changes",
    "Watching for asset changes...": "Watching for changes",
  }
  for (const [text, summary] of Object.entries(cases)) assert.equal(summarizeStep(text), summary, text)
})

test("other steps keep their words: no check mark or timestamp, package-relative paths, capitalized", () => {
  const cases = {
    "✓ Generated: /Users/mohammedibrahim/nice/styles/dist/tokens.css": "Generated dist/tokens.css",
    "✓ Generated: 19 files in /Users/mohammedibrahim/nice/styles/dist/css": "Generated 19 files in dist/css",
    "✓ Component night tokens validated": "Component night tokens validated",
    "✓ Generated TypeScript types: /Users/mohammedibrahim/nice/styles/src/generated/types.ts": "Generated TypeScript types: src/generated/types.ts",
    "✓ Generated icons index + catalog + source + base64 (js/d.ts) with 83 icons": "Generated icons index + catalog + source + base64 (js/d.ts) with 83 icons",
    "rebuilding tokens": "Rebuilding tokens",
  }
  for (const [text, summary] of Object.entries(cases)) assert.equal(summarizeStep(text), summary, text)
})

test("stack frames and tsup's ignore banner are not steps", () => {
  const parser = createParser("x")
  for (const line of ['CLI Ignoring changes in "**/{.git,node_modules}/**" | "dist"', "    at Worker.emit (node:events:507:28)"]) {
    assert.deepEqual(parser.feed(line), [], line)
  }
})
