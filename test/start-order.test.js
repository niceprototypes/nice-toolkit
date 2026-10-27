const { test } = require("node:test")
const assert = require("node:assert/strict")
const { niceDependencies, scheduleStarts } = require("../src/linking/start-order")

/** A start() whose packages settle when the test says so, recording the start order. */
function controllableStart() {
  const started = []
  const resolvers = new Map()
  const start = (name) => {
    started.push(name)
    return new Promise((resolve) => resolvers.set(name, resolve))
  }
  const finish = async (name, outcome = "ready") => {
    resolvers.get(name)(outcome)
    await new Promise((r) => setImmediate(r))
  }
  return { start, started, finish }
}

const graph = (edges) => new Map(Object.entries(edges).map(([name, deps]) => [name, new Set(deps)]))

test("niceDependencies reads nice-* names from every dependency field", () => {
  const deps = niceDependencies({
    dependencies: { "nice-a": "1", react: "19" },
    devDependencies: { "nice-b": "file:../b" },
    peerDependencies: { "nice-c": "^1" },
  })
  assert.deepEqual([...deps].sort(), ["nice-a", "nice-b", "nice-c"])
})

test("dependencies start first; packages of the same tier start together", async () => {
  const { start, started, finish } = controllableStart()
  const done = scheduleStarts(graph({ styles: [], flex: ["styles"], ink: ["styles"], nav: ["flex", "ink"] }), start)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, ["styles"])
  await finish("styles")
  assert.deepEqual(started.slice(1).sort(), ["flex", "ink"])
  await finish("flex")
  assert.ok(!started.includes("nav"), "nav waits for both flex and ink")
  await finish("ink")
  assert.equal(started.at(-1), "nav")
  await finish("nav")
  const outcomes = await done
  assert.equal(outcomes.size, 4)
})

test("a failed or exited dependency still releases its dependents", async () => {
  const { start, started, finish } = controllableStart()
  const settled = []
  const done = scheduleStarts(graph({ a: [], b: ["a"], c: ["b"] }), start, {
    onSettled: (name, outcome) => settled.push(`${name}:${outcome}`),
  })
  await new Promise((r) => setImmediate(r))
  await finish("a", "failed")
  assert.ok(started.includes("b"))
  await finish("b", "exited")
  assert.ok(started.includes("c"))
  await finish("c")
  await done
  assert.deepEqual(settled, ["a:failed", "b:exited", "c:ready"])
})

test("a first build that never settles times out and releases its dependents", async () => {
  const timers = []
  const { start, started } = controllableStart()
  const done = scheduleStarts(graph({ slow: [], next: ["slow"] }), start, {
    timeoutMs: 1000,
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
  })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, ["slow"])
  timers[0]() // slow's timeout fires
  assert.ok(started.includes("next"))
  timers[1]() // next's timeout too, so the schedule completes
  const outcomes = await done
  assert.equal(outcomes.get("slow"), "timeout")
})

test("a dependency cycle starts its members together instead of deadlocking", async () => {
  const { start, started, finish } = controllableStart()
  const cycles = []
  const done = scheduleStarts(graph({ x: ["y"], y: ["x"] }), start, { onCycle: (names) => cycles.push(names) })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started.sort(), ["x", "y"])
  assert.equal(cycles.length, 1)
  await finish("x")
  await finish("y")
  await done
})

test("only the cycle starts; packages depending on it still wait for it", async () => {
  // The react-icon <-> react-icon-vendor shape: button depends on the cycle, nav on button
  const { start, started, finish } = controllableStart()
  const done = scheduleStarts(
    graph({ icon: ["vendor"], vendor: ["icon"], button: ["icon"], nav: ["button", "icon"], image: ["imageVendor"], imageVendor: ["image"] }),
    start
  )
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started.sort(), ["icon", "image", "imageVendor", "vendor"])
  await finish("icon")
  await finish("vendor")
  assert.deepEqual(started.slice(4), ["button"])
  await finish("button")
  assert.deepEqual(started.slice(5), ["nav"])
  await finish("nav")
  await finish("image")
  await finish("imageVendor")
  await done
})
