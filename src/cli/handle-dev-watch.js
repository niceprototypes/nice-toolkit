const { startWatching } = require('../linking/watcher');
const { startDevRunner } = require('../linking/dev-runner');
const { stopDevelop } = require('../linking/dev-groups');
const { installShutdownHandlers } = require('./develop/shutdown');
const { createDevelopView } = require('./develop/develop-view');
const { info } = require('../shared/logger');

/**
 * Starts dev runner and/or watcher processes, and stops them on every exit the process can
 * catch (see develop/shutdown). This function does not return — it keeps the process alive.
 *
 * Output is the develop view (develop/develop-view): a live tree on a TTY, one line per state
 * change otherwise; `--verbose` lists build steps. `--raw` prints every watcher line, prefixed, instead.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} options - Parsed CLI options
 * @param {string} options.pidFile - Record of the running watcher groups
 * @private
 */
function handleDevWatch(projectDir, options) {
  // `nicely develop --stop`
  if (options.stop) {
    if (stopDevelop(options.pidFile) === 0) info('No nicely develop watchers running');
    process.exit(0);
  }

  // The view owns stdout from its first frame, so the reload watcher (which logs the packages
  // it skips) starts first
  const view = options.dev && !options.raw ? createDevelopView({ verbose: options.verbose }) : null;
  let devController = null;
  let watchController = null;

  if (options.watch) {
    watchController = startWatching(projectDir, {
      watchDir: options.watchDir,
      verbose: !view,
      onReload: view?.reloadPing,
    });
  }

  if (options.dev) {
    devController = startDevRunner(projectDir, { verbose: options.raw, pidFile: options.pidFile, reporter: view ?? undefined });
  }

  installShutdownHandlers(() => {
    if (view) view.done();
    if (watchController) watchController.stop();
    if (devController) devController.stop();
  });
}

module.exports = { handleDevWatch };
