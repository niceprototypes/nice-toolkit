/**
 * @fileoverview Runs `nicely develop`'s stop on every exit the process can catch.
 *
 * SIGINT (Ctrl+C), SIGTERM and SIGHUP (terminal closed) stop and exit; an uncaught exception or
 * unhandled rejection reports the error, stops and exits 1; `exit` covers any other
 * `process.exit`. The stop runs once. It must be synchronous: `exit` handlers cannot wait.
 * SIGKILL cannot be caught; the group leader's stdin watchdog covers it (dev-group-leader.js).
 *
 * @module cli/develop/shutdown
 */

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * @param {() => void} stop - Synchronous
 * @param {object} [options]
 * @param {NodeJS.EventEmitter} [options.target=process]
 * @param {(code: number) => void} [options.exit]
 */
function installShutdownHandlers(stop, { target = process, exit = (code) => process.exit(code) } = {}) {
  let stopped = false;
  const stopOnce = () => {
    if (stopped) return;
    stopped = true;
    stop();
  };

  for (const signal of SIGNALS) {
    target.on(signal, () => {
      stopOnce();
      exit(0);
    });
  }
  target.on('exit', stopOnce);

  const crash = (error) => {
    try {
      console.error(error);
    } catch {
      /* stderr gone with the terminal */
    }
    stopOnce();
    exit(1);
  };
  target.on('uncaughtException', crash);
  target.on('unhandledRejection', crash);
}

module.exports = { installShutdownHandlers, SIGNALS };
