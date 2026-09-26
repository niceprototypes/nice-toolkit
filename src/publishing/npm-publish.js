/**
 * @fileoverview Async, bounded `npm publish` runner.
 *
 * Replaces the former `execSync` call, which blocked the event loop (the heart
 * spinner froze on "Publishing …"), hid every byte of npm's output, and could
 * never be timed out. This runner:
 *
 * - spawns npm asynchronously, so the reporter keeps animating and signal
 *   handlers (SIGINT/SIGHUP/SIGTERM → restore swaps) run immediately;
 * - captures stdout + stderr for the existing isOtpError / shortReason logic;
 * - surfaces, as they arrive, any line that carries a URL (web-auth link) or
 *   reads like a prompt, so the user is never left staring at a silent wait;
 * - kills npm after `timeoutMs` and reports `timedOut: true`.
 *
 * Why npm's routine output is still suppressed: `npm publish` writes a
 * `npm notice` line per tarball file (100+ per package), which is noise on a
 * 30-package run. Only the actionable lines are passed through.
 *
 * Note (npm 11): npm only falls back to web-based 2FA or an interactive
 * "Enter OTP:" prompt when BOTH its stdin and stdout are TTYs
 * (lib/utils/auth.js `otplease`). stdout here is a pipe, so a rejected code
 * fails fast with EOTP and nicely's own re-prompt takes over. The URL/prompt
 * surfacing is a guard for npm versions or registries that behave otherwise.
 *
 * @module publisher/npm-publish
 */

const { spawn } = require("child_process")

/** Default per-package publish timeout, in seconds. */
const DEFAULT_PUBLISH_TIMEOUT_S = 120

/** Grace period between SIGTERM and SIGKILL when a timed-out npm won't exit. */
const KILL_GRACE_MS = 5000

const URL_RE = /https?:\/\/\S+/
const PROMPT_RE = /enter otp|one-time password|authenticate your account|login at|press enter|open .*browser/i

/**
 * Whether a line of npm output should be shown to the user immediately.
 * `npm notice` lines (tarball contents) never qualify.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isActionableLine(line) {
  const t = line.trim()
  if (!t || /^npm notice\b/.test(t)) return false
  return URL_RE.test(t) || PROMPT_RE.test(t)
}

/**
 * First auth-looking URL in the text, or null.
 *
 * @param {string} text
 * @returns {string|null}
 */
function findAuthUrl(text) {
  for (const line of text.split("\n")) {
    if (/^npm notice\b/.test(line.trim())) continue
    const m = line.match(URL_RE)
    if (m) return m[0]
  }
  return null
}

/**
 * @typedef {object} NpmPublishResult
 * @property {boolean} ok        - npm exited 0
 * @property {boolean} timedOut  - killed after `timeoutMs`
 * @property {number|null} code  - exit code (null when killed by signal)
 * @property {string} text       - combined stderr + stdout
 * @property {string|null} authUrl - first URL npm printed, if any
 */

/**
 * Runs `npm publish --otp=<otp> --ignore-scripts --access public` in `cwd`.
 * Never rejects; every outcome resolves to an NpmPublishResult.
 *
 * @param {object} opts
 * @param {string} opts.cwd - Package directory
 * @param {string} opts.otp - One-time password
 * @param {number} [opts.timeoutMs] - Kill npm after this long (default 120s)
 * @param {(line: string) => void} [opts.onActionable] - Called with each actionable line as it arrives
 * @param {string} [opts.npmBin] - npm executable (default: $NICELY_NPM_BIN or "npm"); tests point it at a fake
 * @returns {Promise<NpmPublishResult>}
 */
function runNpmPublish({ cwd, otp, timeoutMs = DEFAULT_PUBLISH_TIMEOUT_S * 1000, onActionable, npmBin }) {
  const bin = npmBin || process.env.NICELY_NPM_BIN || "npm"
  const args = ["publish", `--otp=${otp}`, "--ignore-scripts", "--access", "public"]

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    let killTimer = null

    // stdin is inherited so npm can read from the terminal if it ever prompts.
    const child = spawn(bin, args, { cwd, stdio: ["inherit", "pipe", "pipe"] })

    // If nicely exits while npm is running (signal, crash), take npm down too.
    const killOnExit = () => {
      try { child.kill("SIGTERM") } catch (_) { /* already gone */ }
    }
    process.once("exit", killOnExit)

    // Line splitter per stream. A trailing partial line that reads like a
    // prompt (prompts end without "\n") is surfaced immediately.
    const watch = (onChunk) => {
      let partial = ""
      return (chunk) => {
        const s = chunk.toString()
        onChunk(s)
        partial += s
        const lines = partial.split("\n")
        partial = lines.pop()
        for (const line of lines) if (onActionable && isActionableLine(line)) onActionable(line.trim())
        if (partial && onActionable && isActionableLine(partial)) {
          onActionable(partial.trim())
          partial = ""
        }
      }
    }
    child.stdout.on("data", watch((s) => { stdout += s }))
    child.stderr.on("data", watch((s) => { stderr += s }))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    }, timeoutMs)

    const finish = (code, spawnError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      process.removeListener("exit", killOnExit)
      const text = [stderr, stdout, spawnError ? String(spawnError.message) : ""].filter(Boolean).join("").trim()
      resolve({
        ok: !timedOut && !spawnError && code === 0,
        timedOut,
        code,
        text,
        authUrl: findAuthUrl(text),
      })
    }

    child.on("error", (err) => finish(null, err))
    child.on("close", (code) => finish(code, null))
  })
}

module.exports = {
  runNpmPublish,
  isActionableLine,
  findAuthUrl,
  DEFAULT_PUBLISH_TIMEOUT_S,
}
