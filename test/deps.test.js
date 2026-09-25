const { test } = require("node:test")
const assert = require("node:assert/strict")
const { rewriteDepsForPublish, restoreDeps } = require("../src/publishing/deps")
const { collectLocalDeps } = require("../src/publishing/graph")

const localVersions = { "nice-styles": "4.2.0", "nice-react-styles": "16.0.0", "nice-react-flex": "3.0.1" }
const getVersion = name => localVersions[name]

function sourcePkg() {
  return {
    name: "nice-react-button",
    dependencies: { "nice-styles": "file:../styles", lodash: "^4.17.21" },
    devDependencies: { "nice-react-styles": "file:../react-styles", vitest: "^3.0.0" },
    peerDependencies: {
      "nice-react-styles": "^15.0.1",
      "nice-react-flex": "^3.0.0",
      react: ">=19.2.0",
      "styled-components": ">=6.1.18",
    },
  }
}

const runVersions = new Map([["nice-react-styles", "16.0.0"], ["nice-react-button", "8.0.0"]])

test("in-run nice-* peer is rewritten to ^newVersion", () => {
  const pkg = sourcePkg()
  rewriteDepsForPublish(pkg, getVersion, runVersions)
  assert.equal(pkg.peerDependencies["nice-react-styles"], "^16.0.0")
})

test("out-of-run nice-* peer and non-nice peers are unchanged", () => {
  const pkg = sourcePkg()
  const originals = rewriteDepsForPublish(pkg, getVersion, runVersions)
  assert.equal(pkg.peerDependencies["nice-react-flex"], "^3.0.0")
  assert.equal(pkg.peerDependencies.react, ">=19.2.0")
  assert.equal(pkg.peerDependencies["styled-components"], ">=6.1.18")
  assert.ok(!("peerDependencies.nice-react-flex" in originals))
  assert.ok(!("peerDependencies.react" in originals))
})

test("non-nice peer is unchanged even if a same-named entry is in the run map", () => {
  const pkg = sourcePkg()
  rewriteDepsForPublish(pkg, getVersion, new Map([["react", "20.0.0"]]))
  assert.equal(pkg.peerDependencies.react, ">=19.2.0")
})

test("file: deps and devDeps still swap to the local version; semver deps untouched", () => {
  const pkg = sourcePkg()
  rewriteDepsForPublish(pkg, getVersion, runVersions)
  assert.equal(pkg.dependencies["nice-styles"], "^4.2.0")
  assert.equal(pkg.devDependencies["nice-react-styles"], "^16.0.0")
  assert.equal(pkg.dependencies.lodash, "^4.17.21")
  assert.equal(pkg.devDependencies.vitest, "^3.0.0")
})

test("no run map: peers untouched (previous behaviour)", () => {
  const pkg = sourcePkg()
  const originals = rewriteDepsForPublish(pkg, getVersion)
  assert.deepEqual(pkg.peerDependencies, sourcePkg().peerDependencies)
  assert.deepEqual(Object.keys(originals).sort(), ["dependencies.nice-styles", "devDependencies.nice-react-styles"])
})

test("peer already at ^newVersion is not recorded", () => {
  const pkg = sourcePkg()
  pkg.peerDependencies["nice-react-styles"] = "^16.0.0"
  const originals = rewriteDepsForPublish(pkg, getVersion, runVersions)
  assert.ok(!("peerDependencies.nice-react-styles" in originals))
})

test("restore returns the exact source package.json", () => {
  const pkg = sourcePkg()
  const originals = rewriteDepsForPublish(pkg, getVersion, runVersions)
  assert.equal(originals["peerDependencies.nice-react-styles"], "^15.0.1")
  assert.notDeepEqual(pkg, sourcePkg())
  restoreDeps(pkg, originals)
  assert.deepEqual(pkg, sourcePkg())
})

test("graph: peer edges are counted alongside file: deps/devDeps", () => {
  const all = ["nice-styles", "nice-react-styles", "nice-react-flex", "nice-react-button"]
  assert.deepEqual([...collectLocalDeps(sourcePkg(), all)].sort(), ["nice-react-flex", "nice-react-styles", "nice-styles"])
})

test("graph: a peer-only nice-* dep is still an edge; unregistered and non-nice peers are not", () => {
  const pkg = { peerDependencies: { "nice-react-styles": "^15.0.1", "nice-unknown": "^1.0.0", react: ">=19" } }
  assert.deepEqual([...collectLocalDeps(pkg, ["nice-react-styles"])], ["nice-react-styles"])
})

test("graph: semver (non-file:) dependencies are still not edges", () => {
  const pkg = { dependencies: { "nice-react-styles": "^15.0.1" } }
  assert.deepEqual([...collectLocalDeps(pkg, ["nice-react-styles"])], [])
})
