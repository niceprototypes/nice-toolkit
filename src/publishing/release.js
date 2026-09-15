/**
 * @fileoverview Publish phase
 *
 * Publishes built packages to npm as a `runTasks` checklist — one line per
 * package, checked off (`✓ name@version`) as each publish succeeds. npm's own
 * `npm notice` tarball output is captured and discarded on success; only on a
 * failure is the captured error rendered beneath the failed (`✗`) line.
 *
 * Packages are already built and deps swapped — each publish only runs
 * `npm publish --ignore-scripts`.
 *
 * OTP codes are primed once before the checklist and reused until npm rejects
 * one. A rejection re-prompts (pausing the spinner so the prompt owns the line)
 * up to MAX_OTP_RETRIES times per package. If retries are exhausted, the auth
 * state is broken, so every remaining package is skipped.
 *
 * @module publisher/release
 */

const { info, log } = require("../shared/logger")
const { runTasks, createReporter } = require("../shared/tasks")
const { runShellCapture, pkgDir } = require("./helpers")
const { createOtpManager, isOtpError } = require("./otp")

const MAX_OTP_RETRIES = 3

/**
 * Combine a failed execSync error's captured streams into one text blob. npm
 * writes its diagnostics to stderr; stdout is included as a fallback.
 *
 * @param {any} e - The error thrown by execSync
 * @returns {string}
 */
function errorText(e) {
  const captured = [e.stderr, e.stdout].filter(Boolean).map(String).join("").trim()
  return captured || (e && e.message ? String(e.message) : String(e))
}

/**
 * A short one-line reason for the failed task line, drawn from npm's output —
 * the first line that reads like an error, else the first non-empty line.
 *
 * @param {string} text - Full captured error text
 * @returns {string}
 */
function shortReason(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const errLine = lines.find((l) => /npm error|error\b|E[A-Z]{2,}|\b4\d\d\b/i.test(l))
  return (errLine || lines[0] || "publish failed").slice(0, 100)
}

/**
 * Publishes a single package, retrying on OTP errors up to MAX_OTP_RETRIES
 * times, and resolves to a task Outcome (never throws). The npm output is
 * captured: on success it is dropped; on failure it rides along as the
 * Outcome's `output` so the reporter can print it beneath the failed line.
 *
 * @param {object} pkg - Built package to publish (`{ name, newVersion }`)
 * @param {ReturnType<typeof createOtpManager>} otp - OTP manager
 * @param {import("../shared/tasks/reporter").Reporter} reporter - active reporter (for pause/resume)
 * @param {() => void} markHalted - called when OTP retries are exhausted
 * @returns {Promise<import("../shared/tasks/status").Outcome>}
 */
async function publishTask(pkg, otp, reporter, markHalted) {
  const dir = pkgDir(pkg.name)
  let attempts = 0

  while (attempts <= MAX_OTP_RETRIES) {
    // attempts 0 reuses the primed code (no prompt). A retry re-prompts, first
    // pausing the spinner so readline owns the line, then restoring it.
    let code
    if (attempts === 0) {
      code = await otp.get()
    } else {
      reporter.pause()
      try {
        code = await otp.get(true)
      } finally {
        reporter.resume()
      }
    }

    try {
      // --ignore-scripts skips rebuild — packages are already built in the build
      // phase. Output is captured (runShellCapture), so npm's notices stay hidden.
      runShellCapture(`npm publish --otp=${code} --ignore-scripts --access public`, { cwd: dir })
      return { kind: "done" }
    } catch (e) {
      const text = errorText(e)

      if (!isOtpError(text)) {
        return { kind: "failed", detail: shortReason(text), output: text }
      }

      attempts++
      otp.invalidate()

      if (attempts > MAX_OTP_RETRIES) {
        markHalted()
        return {
          kind: "failed",
          detail: `OTP rejected ${MAX_OTP_RETRIES}× — publish halted`,
          output: text,
        }
      }
      // else: loop and re-prompt for a fresh code
    }
  }

  // Unreachable — every path in the loop returns. Satisfies static analyzers.
  markHalted()
  return { kind: "failed", detail: "OTP retries exhausted" }
}

/**
 * Publishes packages to npm as a checklist with reactive OTP management.
 *
 * @param {object[]} publishable - Built packages ready to publish
 * @param {boolean} doPublish - Whether to actually publish to npm
 * @returns {Promise<{ published: string[], failed: string[] }>}
 */
async function releasePackages(publishable, doPublish) {
  const reporter = createReporter()

  // --no-npm: the bump/build/commit still happen upstream; render the queue as
  // skipped and report every package as "published" so commit/tag proceeds.
  if (!doPublish) {
    info(`--no-npm: skipping npm publish for ${publishable.length} package(s).`)
    const tasks = publishable.map((pkg) => ({
      label: `${pkg.name}@${pkg.newVersion}`,
      run: () => ({ kind: "skipped", detail: "--no-npm" }),
    }))
    await runTasks(tasks, { reporter, summary: false })
    return { published: publishable.map((p) => p.name), failed: [] }
  }

  log(`\nPublishing ${publishable.length} package(s)...\n`)

  const otp = createOtpManager()
  // Prime the OTP once, before the checklist, so the prompt never fights a live
  // spinner. Reused for every package; only a rejection triggers a re-prompt.
  await otp.get()

  // Shared kill-switch: once OTP retries are exhausted the auth state is broken,
  // so every subsequent task skips instantly instead of hammering npm.
  let halted = false

  const tasks = publishable.map((pkg) => ({
    label: `${pkg.name}@${pkg.newVersion}`,
    activeLabel: `Publishing ${pkg.name}@${pkg.newVersion}`,
    run: () => {
      if (halted) return { kind: "skipped", detail: "publish halted" }
      return publishTask(pkg, otp, reporter, () => {
        halted = true
      })
    },
  }))

  const report = await runTasks(tasks, { verb: "published", reporter, summary: false })

  // Map task outcomes back to package names for the pipeline. A halted skip
  // counts as a failure (the package did not publish), matching prior behavior.
  const published = []
  const failed = []
  for (const pkg of publishable) {
    const outcome = report.outcomes.get(`${pkg.name}@${pkg.newVersion}`)
    if (outcome && outcome.kind === "done") published.push(pkg.name)
    else failed.push(pkg.name)
  }

  return { published, failed }
}

module.exports = { releasePackages }
