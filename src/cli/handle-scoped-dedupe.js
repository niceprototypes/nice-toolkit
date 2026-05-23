const path = require('path');
const { PEER_ENFORCE } = require('../shared/config');
const { success, fail } = require('../shared/logger');
const { validatePackageDir } = require('../linking/discovery');
const { ensurePeerDeps } = require('../linking/peer-deps');
const { removeConflictsInDir } = require('../linking/cleaner');

/**
 * Dedupes singletons in a single linked package (scoped form of --dedupe).
 *
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleScopedDedupe(options) {
  const validation = validatePackageDir(options.pkgPath);
  if (!validation.valid) {
    fail(validation.error);
    process.exit(1);
  }

  const resolvedPath = path.resolve(options.pkgPath);

  if (!options.skipPeerCheck) {
    ensurePeerDeps(resolvedPath, PEER_ENFORCE, { dryRun: options.dryRun });
  }

  removeConflictsInDir(resolvedPath, options.packagesToRemove, {
    dryRun: options.dryRun,
  });

  success('Dedupe completed');
}

module.exports = { handleScopedDedupe };
