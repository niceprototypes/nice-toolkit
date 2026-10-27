/**
 * `nicely build <targets>` stops a running `nicely develop` (its recorded watcher groups) before
 * building, since both write the same dist/. The build itself is stubbed; the "develop" is a real
 * detached process group recorded in a temporary pid file.
 */

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const distBuilder = require("../src/linking/dist-builder")
const cacheCleaner = require("../src/linking/cache-cleaner")
const { probeProcess, recordGroup } = require("../src/linking/dev-groups")

const skip = process.platform === "win32" ? "process groups are POSIX-only" : false

const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** Loads handle-build-icons against a stubbed build that records whether develop was still running. */
function loadHandleBuild(t, watcherPgid) {
  const calls = []
  t.mock.method(distBuilder, "buildAffected", async (roots) => {
    calls.push({ roots, developRunning: watcherPgid !== undefined && groupAlive(watcherPgid) })
    return { built: roots, skipped: [], failed: [] }
  })
  t.mock.method(cacheCleaner, "refreshVite", () => {})
  delete require.cache[require.resolve("../src/cli/handle-build-icons")]
  const { handleBuild } = require("../src/cli/handle-build-icons")
  return { handleBuild, calls }
}

const tempPidFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "build-develop-")), "develop.pids")

test("a recorded nicely develop is stopped before the build starts", { skip }, async (t) => {
  const pidFile = tempPidFile()
  const watcher = spawn("sleep", ["30"], { detached: true, stdio: "ignore" })
  recordGroup(pidFile, { pgid: watcher.pid, cwd: os.tmpdir(), owner: probeProcess(process.pid) })
  t.after(() => groupAlive(watcher.pid) && process.kill(-watcher.pid, "SIGKILL"))

  const { handleBuild, calls } = loadHandleBuild(t, watcher.pid)
  const code = await handleBuild({ pidFile }, ["nice-icons"])

  assert.equal(code, 0)
  assert.deepEqual(calls, [{ roots: ["nice-icons"], developRunning: false }])
  assert.equal(fs.existsSync(pidFile), false)
})

test("with nothing recorded the build runs and nothing is stopped", { skip }, async (t) => {
  const { handleBuild, calls } = loadHandleBuild(t)
  const code = await handleBuild({ pidFile: tempPidFile() }, ["nice-icons"])
  assert.equal(code, 0)
  assert.deepEqual(calls, [{ roots: ["nice-icons"], developRunning: false }])
})
