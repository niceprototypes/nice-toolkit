const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const { publishTask, MAX_OTP_RETRIES } = require("../src/publishing/release")
const { runNpmPublish } = require("../src/publishing/npm-publish")

const FAKE_NPM = path.join(__dirname, "fixtures", "fake-npm.js")
const pkg = { name: "fake-pkg", newVersion: "1.0.0" }

function stubs() {
  const calls = { get: 0, forceNew: 0, pause: 0, resume: 0, halted: 0, written: [] }
  const otp = {
    async get(forceNew) { calls.get++; if (forceNew) calls.forceNew++; return "123456" },
    invalidate() {},
  }
  const reporter = { pause() { calls.pause++ }, resume() { calls.resume++ } }
  return { calls, otp, reporter, markHalted: () => { calls.halted++ } }
}

function run(mode, timeoutMs = 5000) {
  process.env.FAKE_NPM_MODE = mode
  const s = stubs()
  const promise = publishTask(pkg, s.otp, s.reporter, s.markHalted, {
    cwd: __dirname,
    npmBin: FAKE_NPM,
    timeoutMs,
    write: (t) => s.calls.written.push(t),
  })
  return promise.then((outcome) => ({ outcome, calls: s.calls }))
}

test("(a) success resolves done without surfacing npm notice lines", async () => {
  const { outcome, calls } = await run("success")
  assert.equal(outcome.kind, "done")
  assert.equal(calls.written.length, 0)
})

test("(b) EOTP re-prompts up to MAX_OTP_RETRIES then halts", async () => {
  const { outcome, calls } = await run("eotp")
  assert.equal(outcome.kind, "failed")
  assert.match(outcome.detail, /OTP rejected/)
  assert.match(outcome.output, /EOTP/)
  assert.equal(calls.forceNew, MAX_OTP_RETRIES)
  assert.equal(calls.halted, 1)
})

test("(c) a hung npm is killed at the timeout and reported", async () => {
  const start = Date.now()
  const { outcome, calls } = await run("hang", 500)
  assert.ok(Date.now() - start < 4000, "timeout did not fire promptly")
  assert.equal(outcome.kind, "failed")
  assert.equal(outcome.detail, "npm publish timed out after 1s")
  assert.match(outcome.output, /timed out .* check the npm output above/)
  assert.equal(calls.halted, 0, "a timeout is a per-package failure, not an OTP halt")
})

test("(d) an auth URL is surfaced immediately and named in the timeout message", async () => {
  const { outcome, calls } = await run("authurl", 800)
  const shown = calls.written.join("")
  assert.match(shown, /npm needs attention: https:\/\/www\.npmjs\.com\/auth\/cli\/fake-token/)
  assert.match(shown, /Authenticate your account at/)
  assert.ok(calls.pause >= 1 && calls.pause === calls.resume, "spinner paused and resumed around the line")
  assert.equal(outcome.kind, "failed")
  assert.match(outcome.output, /npm printed: https:\/\/www\.npmjs\.com\/auth\/cli\/fake-token/)
})

test("(d2) auth URL followed by npm finishing within the timeout is a success", async () => {
  const { outcome, calls } = await run("authurl-then-ok", 5000)
  assert.equal(outcome.kind, "done")
  assert.match(calls.written.join(""), /fake-token/)
})

test("runNpmPublish reports a missing npm binary instead of throwing", async () => {
  const r = await runNpmPublish({ cwd: __dirname, otp: "1", timeoutMs: 2000, npmBin: "/nonexistent/npm" })
  assert.equal(r.ok, false)
  assert.equal(r.timedOut, false)
  assert.match(r.text, /ENOENT/)
})

for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
  test(`restore guard restores swaps on ${signal}`, async () => {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nicely-guard-")), "marker")
    const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "restore-guard-child.js"), marker], {
      stdio: ["ignore", "pipe", "inherit"],
    })
    await new Promise((resolve) => child.stdout.once("data", resolve))
    const exit = new Promise((resolve) => child.on("exit", (c, s) => resolve({ c, s })))
    child.kill(signal)
    const { c } = await exit
    assert.equal(fs.readFileSync(marker, "utf8"), "restored")
    assert.equal(c, code)
  })
}
