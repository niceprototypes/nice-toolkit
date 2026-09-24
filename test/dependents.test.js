const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  DEPENDENT_KIND,
  classifyDependent,
  partitionCandidates,
  excludeBlockedByUnpublished,
  planTag,
} = require("../src/publishing/dependents")
const { recommendedLevel } = require("../src/publishing/prompts/intent")
const { derivedVersion } = require("../src/publishing/prompts/version")

const dep = (name, fields) => ({
  name,
  localVersion: "1.0.0",
  npmVersion: "1.0.0",
  isNew: false,
  isDependent: true,
  intentLevel: null,
  intentEntries: [],
  ...fields,
})

test("pure dependent is auto-patched", () => {
  const c = dep("nice-react-flex", { localVersion: "2.0.1", npmVersion: "2.0.1" })
  assert.equal(classifyDependent(c), DEPENDENT_KIND.AUTO_PATCH)
  const { walk, autoPatch } = partitionCandidates([], [c])
  assert.equal(walk.length, 0)
  assert.equal(autoPatch.length, 1)
  assert.equal(autoPatch[0].newVersion, "2.0.2")
  assert.equal(autoPatch[0].bumpType, "patch")
  assert.equal(planTag(c), "dependent")
})

test("dependent with a major entry is prompted with major recommended", () => {
  const c = dep("nice-react-input", {
    localVersion: "3.0.2",
    npmVersion: "3.0.2",
    intentLevel: "major",
    intentEntries: [
      { level: "patch", message: "Fix focus ring" },
      { level: "major", message: "Rename size prop" },
    ],
  })
  assert.equal(classifyDependent(c), DEPENDENT_KIND.INTENT)
  const { walk, autoPatch } = partitionCandidates([], [c])
  assert.equal(autoPatch.length, 0)
  assert.deepEqual(walk.map(w => w.name), ["nice-react-input"])
  assert.equal(recommendedLevel(walk[0]), "major")
  assert.equal(derivedVersion(walk[0], recommendedLevel(walk[0])), "4.0.0")
  assert.equal(planTag(c), "dependent, bump notes")
})

test("never-published dependent is prompted as a first publish at its local version", () => {
  const c = dep("nice-react-popover", { localVersion: "0.1.0", npmVersion: null, isNew: true })
  assert.equal(classifyDependent(c), DEPENDENT_KIND.FIRST_PUBLISH)
  const { walk, autoPatch } = partitionCandidates([], [c])
  assert.equal(autoPatch.length, 0)
  assert.deepEqual(walk.map(w => w.name), ["nice-react-popover"])
  assert.equal(recommendedLevel(walk[0]), "as-is")
  assert.equal(derivedVersion(walk[0], "as-is"), "0.1.0")
  assert.equal(planTag(c), "FIRST publish, dependent")
})

test("never-published dependent with bump entries is still a first publish", () => {
  const c = dep("nice-react-field", { localVersion: "0.1.0", npmVersion: null, isNew: true, intentLevel: "minor" })
  assert.equal(classifyDependent(c), DEPENDENT_KIND.FIRST_PUBLISH)
})

test("changed packages always lead the walk", () => {
  const changed = { name: "nice-styles", isNew: false, intentLevel: "minor", intentEntries: [] }
  const { walk } = partitionCandidates([changed], [dep("nice-react-popover", { isNew: true, npmVersion: null })])
  assert.deepEqual(walk.map(w => w.name), ["nice-styles", "nice-react-popover"])
})

test("unenriched dependent throws instead of silently auto-patching", () => {
  assert.throws(() => classifyDependent({ name: "nice-react-flex", isNew: false }), TypeError)
})

test("skipping a new package drops its dependents with the blocking package named", () => {
  const popover = dep("nice-react-popover", { isNew: true, npmVersion: null })
  const field = dep("nice-react-field", { isNew: true, npmVersion: null })
  const tooltip = dep("nice-react-tooltip")
  const flex = dep("nice-react-flex")
  const reverseMap = new Map([
    ["nice-react-popover", new Set(["nice-react-field", "nice-react-tooltip"])],
    ["nice-react-field", new Set(["nice-react-form"])],
  ])
  const form = dep("nice-react-form")
  // popover skipped: not in toPublish.
  const toPublish = [field, tooltip, flex, form]
  const { kept, dropped } = excludeBlockedByUnpublished(toPublish, [popover, field, tooltip, flex, form], reverseMap)
  assert.deepEqual(kept.map(p => p.name), ["nice-react-flex"])
  assert.deepEqual(dropped, [
    { name: "nice-react-field", blockedBy: "nice-react-popover" },
    { name: "nice-react-tooltip", blockedBy: "nice-react-popover" },
    { name: "nice-react-form", blockedBy: "nice-react-field" },
  ])
})

test("accepted new packages block nothing", () => {
  const popover = dep("nice-react-popover", { isNew: true, npmVersion: null })
  const tooltip = dep("nice-react-tooltip")
  const reverseMap = new Map([["nice-react-popover", new Set(["nice-react-tooltip"])]])
  const { kept, dropped } = excludeBlockedByUnpublished([popover, tooltip], [popover, tooltip], reverseMap)
  assert.deepEqual(kept.map(p => p.name), ["nice-react-popover", "nice-react-tooltip"])
  assert.deepEqual(dropped, [])
})
