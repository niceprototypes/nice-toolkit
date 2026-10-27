const { test } = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("events")
const { installShutdownHandlers, SIGNALS } = require("../src/cli/develop/shutdown")

function setup() {
  const target = new EventEmitter()
  const calls = { stop: 0, exits: [] }
  installShutdownHandlers(() => calls.stop++, { target, exit: (code) => calls.exits.push(code) })
  return { target, calls }
}

for (const signal of SIGNALS) {
  test(`${signal} stops the watchers and exits 0`, () => {
    const { target, calls } = setup()
    target.emit(signal)
    assert.equal(calls.stop, 1)
    assert.deepEqual(calls.exits, [0])
  })
}

test("process exit stops the watchers", () => {
  const { target, calls } = setup()
  target.emit("exit", 0)
  assert.equal(calls.stop, 1)
  assert.deepEqual(calls.exits, [])
})

for (const event of ["uncaughtException", "unhandledRejection"]) {
  test(`${event} stops the watchers and exits 1`, (t) => {
    t.mock.method(console, "error", () => {})
    const { target, calls } = setup()
    target.emit(event, new Error("boom"))
    assert.equal(calls.stop, 1)
    assert.deepEqual(calls.exits, [1])
  })
}

test("stop runs once however many exits fire", () => {
  const { target, calls } = setup()
  target.emit("SIGHUP")
  target.emit("SIGINT")
  target.emit("exit", 0)
  assert.equal(calls.stop, 1)
})
