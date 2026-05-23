const { startWatching } = require('../linking/watcher');
const { startDevRunner } = require('../linking/dev-runner');

/**
 * Starts dev runner and/or watcher processes.
 * Sets up SIGINT/SIGTERM handlers for graceful shutdown.
 * This function does not return — it keeps the process alive.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleDevWatch(projectDir, options) {
  let devController = null;
  let watchController = null;

  if (options.dev) {
    devController = startDevRunner(projectDir, { verbose: true });
  }

  if (options.watch) {
    watchController = startWatching(projectDir, {
      watchDir: options.watchDir,
      verbose: true,
    });
  }

  // Graceful shutdown on Ctrl+C or kill signal
  const shutdown = () => {
    if (watchController) watchController.stop();
    if (devController) devController.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { handleDevWatch };
