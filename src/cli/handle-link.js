const path = require('path');
const { PEER_ENFORCE } = require('../shared/config');
const { success, warn, fail, cyan } = require('../shared/logger');
const { showUsage } = require('../args');
const { isWorkspaceRoot } = require('../linking/pm');
const { readPkgName, validatePackageDir } = require('../linking/discovery');
const { ensurePeerDeps } = require('../linking/peer-deps');
const { removeConflictsInDir } = require('../linking/cleaner');
const { linkPackage } = require('../linking/linker');
const { showCRAAdvice } = require('./show-cra-advice');
const { showNextSteps } = require('./show-next-steps');

/**
 * Links a package via file: protocol and cleans conflicts.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} options - Parsed CLI options
 * @private
 */
function handleLink(projectDir, options) {
  if (!options.pkgPath) {
    fail('Please provide a path to the package you want to link');
    showUsage();
    process.exit(1);
  }

  const validation = validatePackageDir(options.pkgPath);
  if (!validation.valid) {
    fail(validation.error);
    process.exit(1);
  }

  const resolvedPath = path.resolve(options.pkgPath);

  if (isWorkspaceRoot(projectDir) && !options.forcedPM) {
    warn('Workspaces detected. Consider using "workspace:" or local file deps instead of linking.');
  }

  if (!options.skipPeerCheck) {
    ensurePeerDeps(resolvedPath, PEER_ENFORCE, { dryRun: options.dryRun });
  }

  // Clean → link → detect CRA → clean again
  // The second clean pass is needed because npm install during linking
  // may reinstall the same conflicting singletons we just removed
  removeConflictsInDir(resolvedPath, options.packagesToRemove, { dryRun: options.dryRun });

  const pkgName = readPkgName(resolvedPath);
  linkPackage(options.pm, resolvedPath, pkgName, { dryRun: options.dryRun });

  const isCRA = showCRAAdvice(projectDir);

  removeConflictsInDir(resolvedPath, options.packagesToRemove, { dryRun: options.dryRun });

  success(`Successfully linked ${cyan(pkgName)}!`);
  showNextSteps(resolvedPath, isCRA);
}

module.exports = { handleLink };
