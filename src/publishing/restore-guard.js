/**
 * @fileoverview Guarantees the package.json swap restore on every exit path.
 *
 * `finally` does not run when the process dies from a signal or calls
 * `process.exit()` from another listener. Two gaps existed:
 *
 * - SIGINT: `shared/heart-spinner` registers its own SIGINT listener at module
 *   load (before publish's), and it calls `process.exit(130)` — so publish's
 *   SIGINT handler never ran. Hooking `process.on("exit")` covers that path and
 *   any other `process.exit()`.
 * - SIGHUP (terminal closed): no handler at all, so Node's default action
 *   terminated the process with the swaps still on disk.
 *
 * `restore` must be synchronous (exit listeners cannot await).
 *
 * @module publisher/restore-guard
 */

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGHUP: 129, SIGTERM: 143 }

/**
 * Installs exit/signal hooks that call `restore` (which must be idempotent and
 * synchronous). Returns an uninstall function for the normal-exit path.
 *
 * @param {() => void} restore
 * @returns {() => void} uninstall
 */
function installRestoreGuard(restore) {
  const handlers = {}
  for (const [signal, exitCode] of Object.entries(SIGNAL_EXIT_CODES)) {
    handlers[signal] = () => {
      restore()
      process.exit(exitCode)
    }
    process.on(signal, handlers[signal])
  }
  process.on("exit", restore)

  return () => {
    for (const [signal, handler] of Object.entries(handlers)) process.removeListener(signal, handler)
    process.removeListener("exit", restore)
  }
}

module.exports = { installRestoreGuard, SIGNAL_EXIT_CODES }
