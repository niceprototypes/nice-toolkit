/**
 * The group leader stops its whole process group when its stdin closes, including when the
 * process holding the pipe (nicely develop) is SIGKILLed. Uses a real `npm run dev` whose script
 * leaves a backgrounded grandchild, the shape of `npm run dev` → rollup -c -w.
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const LEADER = path.join(__dirname, "..", "src", "linking", "dev-group-leader.js")
const skip = process.platform === "win32" ? "process groups are POSIX-only" : false

function fakePackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-leader-"))
  const script = "sleep 60 & echo started; wait"
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fake", scripts: { dev: script } }))
  return dir
}

const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return check()
}

/** Resolves once the dev script has printed, i.e. the grandchild is running. */
const started = (child) =>
  new Promise((resolve) => child.stdout.on("data", (data) => String(data).includes("started") && resolve()))

test("closing the leader's stdin stops the whole group", { skip }, async () => {
  const leader = spawn(process.execPath, [LEADER], { cwd: fakePackage(), detached: true, stdio: ["pipe", "pipe", "inherit"] })
  await started(leader)
  assert.ok(groupAlive(leader.pid))
  leader.stdin.end()
  assert.ok(await until(() => !groupAlive(leader.pid)), "group still running after stdin closed")
})

test("SIGKILL of the process holding the pipe stops the whole group", { skip }, async () => {
  // An intermediate node process plays nicely develop: it spawns the leader and reports its pid
  const parentScript = `
    const { spawn } = require("child_process")
    const leader = spawn(process.execPath, [${JSON.stringify(LEADER)}], { detached: true, stdio: ["pipe", "pipe", "inherit"] })
    leader.stdout.on("data", (data) => String(data).includes("started") && console.log("leader " + leader.pid))
    setInterval(() => {}, 1000)
  `
  const parent = spawn(process.execPath, ["-e", parentScript], { cwd: fakePackage(), stdio: ["ignore", "pipe", "inherit"] })
  const pgid = await new Promise((resolve) =>
    parent.stdout.on("data", (data) => {
      const match = String(data).match(/leader (\d+)/)
      if (match) resolve(Number(match[1]))
    })
  )
  assert.ok(groupAlive(pgid))
  parent.kill("SIGKILL")
  assert.ok(await until(() => !groupAlive(pgid)), "group survived its parent's SIGKILL")
})

test("SIGTERM to the group stops it, grandchildren included", { skip }, async () => {
  const leader = spawn(process.execPath, [LEADER], { cwd: fakePackage(), detached: true, stdio: ["pipe", "pipe", "inherit"] })
  await started(leader)
  process.kill(-leader.pid, "SIGTERM")
  assert.ok(await until(() => !groupAlive(leader.pid)), "group still running after SIGTERM")
})
