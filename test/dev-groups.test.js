const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { recordGroup, forgetOwner, cleanOrphanedGroups, findRecordedGroups, stopDevelop, warnMissingBuilds } = require("../src/linking/dev-groups")

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dev-groups-")), ".nice", "develop.pids")
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [])

/** A process table the tests edit; `probe` reads it the way `ps` would. */
function processTable(rows) {
  const table = new Map(rows.map((row) => [row.pid, row]))
  const probe = (pid) => table.get(pid) ?? null
  const killed = []
  const kill = (pid, signal) => {
    killed.push([pid, signal])
    // A SIGTERMed group exits unless it is marked stubborn
    const leader = table.get(-pid)
    if (pid < 0 && leader && (signal === "SIGKILL" || !leader.stubborn)) table.delete(-pid)
  }
  return { table, probe, kill, killed, wait: () => {} }
}

const owner = { pid: 100, started: "Thu Oct  8 10:00:00 2026", command: "node nicely develop" }
const leader = (pid, extra = {}) => ({ pid, started: "Thu Oct  8 10:00:01 2026", command: "node dev-group-leader.js", ...extra })

test("recordGroup stores the leader's start time and command; forgetOwner removes the owner's groups", () => {
  const file = tempFile()
  const { probe } = processTable([owner, leader(201), leader(202)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, { probe })
  recordGroup(file, { pgid: 202, cwd: "/nice/b", owner }, { probe })
  recordGroup(file, { pgid: 999, cwd: "/nice/gone", owner }, { probe })
  assert.deepEqual(read(file).map((entry) => [entry.pgid, entry.command]), [
    [201, "node dev-group-leader.js"],
    [202, "node dev-group-leader.js"],
  ])
  forgetOwner(file, owner)
  assert.equal(fs.existsSync(file), false, "an empty record deletes the file")
})

test("startup stops groups whose owner is dead and drops groups that already exited", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201), leader(202)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  recordGroup(file, { pgid: 202, cwd: "/nice/b", owner }, procs)
  procs.table.delete(owner.pid)
  procs.table.delete(202)
  const { orphaned, liveOwners } = cleanOrphanedGroups(file, procs)
  assert.deepEqual(orphaned.map((entry) => entry.pgid), [201])
  assert.deepEqual(liveOwners, [])
  assert.deepEqual(procs.killed, [[-201, "SIGTERM"]])
  assert.equal(fs.existsSync(file), false)
})

test("a group that ignores SIGTERM is SIGKILLed after the grace window", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201, { stubborn: true })])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  procs.table.delete(owner.pid)
  cleanOrphanedGroups(file, procs)
  assert.deepEqual(procs.killed, [[-201, "SIGTERM"], [-201, "SIGKILL"]])
})

test("a reused pid is never signaled: start time or command must match the record", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201), leader(202)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  recordGroup(file, { pgid: 202, cwd: "/nice/b", owner }, procs)
  procs.table.delete(owner.pid)
  procs.table.set(201, leader(201, { started: "Fri Oct  9 09:00:00 2026" }))
  procs.table.set(202, leader(202, { command: "/Applications/Safari.app" }))
  const { orphaned } = cleanOrphanedGroups(file, procs)
  assert.deepEqual(orphaned, [])
  assert.deepEqual(procs.killed, [])
})

test("startup keeps the groups of another nicely develop that is still running", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  const { orphaned, liveOwners } = cleanOrphanedGroups(file, procs)
  assert.deepEqual(orphaned, [])
  assert.deepEqual(liveOwners, [owner])
  assert.deepEqual(procs.killed, [])
  assert.equal(read(file).length, 1)
})

test("stopDevelop stops every recorded group and SIGTERMs their running owner", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201), leader(202)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  recordGroup(file, { pgid: 202, cwd: "/nice/b", owner }, procs)
  assert.deepEqual(findRecordedGroups(file, procs).owners, [owner])
  assert.equal(stopDevelop(file, procs), 2)
  assert.deepEqual(procs.killed, [[100, "SIGTERM"], [-201, "SIGTERM"], [-202, "SIGTERM"]])
  assert.equal(fs.existsSync(file), false)
})

test("stopDevelop under dryRun reports the running groups and signals nothing", () => {
  const file = tempFile()
  const procs = processTable([owner, leader(201)])
  recordGroup(file, { pgid: 201, cwd: "/nice/a", owner }, procs)
  assert.equal(stopDevelop(file, { ...procs, dryRun: true }), 1)
  assert.deepEqual(procs.killed, [])
  assert.equal(read(file).length, 1)
})

test("a missing or corrupt record reads as empty", () => {
  const file = tempFile()
  const procs = processTable([])
  assert.deepEqual(cleanOrphanedGroups(file, procs), { orphaned: [], liveOwners: [], ended: [] })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "{not json")
  assert.equal(stopDevelop(file, procs), 0)
  assert.deepEqual(procs.killed, [])
})

/** A package directory whose `main` (dist/index.js) is built or not. */
function packageDir(name, built) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, main: "dist/index.js" }))
  if (built) {
    fs.mkdirSync(path.join(dir, "dist"))
    fs.writeFileSync(path.join(dir, "dist/index.js"), "")
  }
  return dir
}

test("warnMissingBuilds names the packages whose main is missing", (t) => {
  const warned = t.mock.method(console, "log", () => {})
  const names = warnMissingBuilds([packageDir("nice-react-flex", false), packageDir("nice-react-ink", true)])
  assert.deepEqual(names, ["nice-react-flex"])
  assert.match(String(warned.mock.calls[0].arguments[0]), /1 package has no build output .*: react-flex\. run nicely develop again, or nicely build nice-react-flex/)
  assert.deepEqual(warnMissingBuilds([packageDir("nice-react-ink", true)]), [])
})

test("stopDevelop warns about stopped packages left without their build", (t) => {
  const warned = t.mock.method(console, "log", () => {})
  const file = tempFile()
  const procs = processTable([owner, leader(201), leader(202)])
  recordGroup(file, { pgid: 201, cwd: packageDir("nice-react-flex", false), owner }, procs)
  recordGroup(file, { pgid: 202, cwd: packageDir("nice-react-ink", true), owner }, procs)
  stopDevelop(file, procs)
  assert.ok(warned.mock.calls.some((call) => /no build output .*: react-flex\./.test(String(call.arguments[0]))))
})

test("startup cleanup reports every ended entry (stopped or already gone), not another develop's", () => {
  const file = tempFile()
  const other = { pid: 300, started: "Thu Oct  8 11:00:00 2026", command: "node nicely develop" }
  const procs = processTable([owner, other, leader(201), leader(202), leader(203)])
  recordGroup(file, { pgid: 201, cwd: "/nice/orphaned", owner }, procs)
  recordGroup(file, { pgid: 202, cwd: "/nice/gone", owner }, procs)
  recordGroup(file, { pgid: 203, cwd: "/nice/other", owner: other }, procs)
  procs.table.delete(owner.pid)
  procs.table.delete(202)
  const { ended } = cleanOrphanedGroups(file, procs)
  assert.deepEqual(ended.map((entry) => entry.cwd), ["/nice/orphaned", "/nice/gone"])
})
