/**
 * @fileoverview Package linking and unlinking operations
 *
 * Provides functions for linking local packages using the file: protocol
 * and restoring original npm versions when unlinking.
 *
 * The file: protocol is preferred over npm link because:
 * - More reliable across package managers
 * - Works better with modern bundlers (webpack, vite)
 * - Easier to track which packages are linked
 * - Supports the Nice ecosystem's interconnected packages
 *
 * @module linker
 */

const path = require('path');
const {
  readJSON,
  writeJSON,
  pathExists,
  ensureDir,
  readDir,
  removeEmptyDir,
  removePath,
} = require('../shared/fs-utils');
const { log, info, success, fail, cyan } = require('../shared/logger');
const { runTasks } = require('../shared/tasks');
const { run } = require('./pm');
const { BACKUP_DIR_NAME, BACKUP_FILE_NAME } = require('../shared/config');

// ──────────────────────────────────────────────────────────────────────────────
// Version Backup
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Gets the backup file path for a project
 *
 * @param {string} projectDir - Project directory path
 * @returns {string} Path to the backup file
 * @private
 */
function getBackupPath(projectDir) {
  return path.join(projectDir, BACKUP_DIR_NAME, BACKUP_FILE_NAME);
}

/**
 * Stores the original package version before linking
 *
 * Saves the original npm version so it can be restored when unlinking.
 * Creates the backup directory if it doesn't exist.
 *
 * @param {string} projectDir - Project directory path
 * @param {string} pkgName - Package name being linked
 * @param {string} version - Original version from package.json
 * @returns {void}
 *
 * @example
 * storeOriginalVersion('/path/to/project', 'nice-react-button', '^3.2.0');
 */
function storeOriginalVersion(projectDir, pkgName, version) {
  const backupDir = path.join(projectDir, BACKUP_DIR_NAME);
  ensureDir(backupDir);

  const backupFile = getBackupPath(projectDir);
  let backup = {};

  if (pathExists(backupFile)) {
    backup = readJSON(backupFile, { useCache: false });
  }

  backup[pkgName] = version;
  writeJSON(backupFile, backup);

  info(`Stored original version: ${cyan(pkgName)}@${version}`);
}

/**
 * Retrieves stored original versions
 *
 * @param {string} projectDir - Project directory path
 * @returns {Object<string, string>|null} Map of package names to versions, or null if no backup
 */
function getStoredVersions(projectDir) {
  const backupFile = getBackupPath(projectDir);

  if (!pathExists(backupFile)) {
    return null;
  }

  return readJSON(backupFile, { useCache: false });
}

/**
 * Cleans up the backup directory after unlinking
 *
 * @param {string} projectDir - Project directory path
 * @private
 */
function cleanupBackup(projectDir) {
  const backupFile = getBackupPath(projectDir);
  const backupDir = path.join(projectDir, BACKUP_DIR_NAME);

  if (pathExists(backupFile)) {
    removePath(backupFile);
  }

  if (pathExists(backupDir) && readDir(backupDir).length === 0) {
    removeEmptyDir(backupDir);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Linking Operations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Links a local package to the current project using the file: protocol
 *
 * This function:
 * 1. Backs up the original version (if any)
 * 2. Updates package.json with file: protocol
 * 3. Runs npm/yarn/pnpm install
 *
 * Using file: protocol is more reliable than npm link because:
 * - It's tracked in package.json (visible to team members)
 * - Works consistently across package managers
 * - Better bundler compatibility
 *
 * @param {string} pm - Package manager to use ('npm', 'yarn', or 'pnpm')
 * @param {string} pkgDir - Absolute path to the package directory to link
 * @param {string} pkgName - Name of the package being linked
 * @param {object} [options] - Options object
 * @param {boolean} [options.dryRun=false] - If true, only logs what would happen
 * @returns {void}
 * @throws {Error} If package.json is not found in the current directory
 *
 * @example
 * linkPackage('npm', '/path/to/nice-react-button', 'nice-react-button');
 */
function linkPackage(pm, pkgDir, pkgName, { dryRun = false } = {}) {
  if (dryRun) {
    info(`[dry-run] Would link ${cyan(pkgName)} via file: protocol`);
    return;
  }

  const projectDir = process.cwd();
  const packageJsonPath = path.join(projectDir, 'package.json');

  if (!pathExists(packageJsonPath)) {
    throw new Error('package.json not found in current directory');
  }

  const packageJson = readJSON(packageJsonPath, { useCache: false });
  const relativePath = path.relative(projectDir, pkgDir);

  // Store original version if it exists and isn't already a file: link
  const originalVersion =
    packageJson.dependencies?.[pkgName] || packageJson.devDependencies?.[pkgName];

  if (originalVersion && !originalVersion.startsWith('file:')) {
    storeOriginalVersion(projectDir, pkgName, originalVersion);
  }

  // Update package.json with file: protocol
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies[pkgName] = `file:${relativePath}`;

  writeJSON(packageJsonPath, packageJson);
  success(`Updated package.json with file: protocol for ${cyan(pkgName)}`);

  // Install the file dependency
  run(pm, ['install']);
  success(`Installed ${cyan(pkgName)} via file: protocol`);
}

/**
 * Unlinks packages and restores their original npm versions
 *
 * This function:
 * 1. Reads the backup file to find original versions
 * 2. Restores each package to its original version in package.json
 * 3. Runs npm install to fetch from registry
 * 4. Cleans up the backup file
 *
 * @param {string} pm - Package manager to use ('npm', 'yarn', or 'pnpm')
 * @param {object} [options] - Options object
 * @param {boolean} [options.dryRun=false] - If true, only logs what would happen
 * @returns {{ unlinkedCount: number }} Number of packages unlinked
 *
 * @example
 * unlinkPackages('npm');
 * // Restores all linked packages to their original npm versions
 */
/**
 * Whether a dependency is currently `file:`-linked in the project's
 * package.json (in either `dependencies` or `devDependencies`).
 *
 * @param {object} packageJson - Parsed project package.json
 * @param {string} pkgName - Dependency name
 * @returns {boolean}
 */
function isLinkedDependency(packageJson, pkgName) {
  const current =
    packageJson.dependencies?.[pkgName] || packageJson.devDependencies?.[pkgName];
  return Boolean(current && current.startsWith('file:'));
}

/**
 * Restores `pkgName`'s version in `packageJson` to `originalVersion`
 * (mutating in place). Looks in `dependencies` first, then
 * `devDependencies`. Returns whether anything was changed.
 *
 * Caller is responsible for the `isLinkedDependency` precheck so this
 * helper stays focused on the write.
 *
 * @param {object} packageJson - Parsed project package.json (mutated)
 * @param {string} pkgName
 * @param {string} originalVersion - Semver value to restore to
 * @returns {boolean} True if a slot was found and overwritten
 */
function restorePackageVersionInPlace(packageJson, pkgName, originalVersion) {
  if (packageJson.dependencies?.[pkgName]) {
    packageJson.dependencies[pkgName] = originalVersion;
    return true;
  }
  if (packageJson.devDependencies?.[pkgName]) {
    packageJson.devDependencies[pkgName] = originalVersion;
    return true;
  }
  return false;
}

async function unlinkPackages(pm, { dryRun = false } = {}) {
  const projectDir = process.cwd();
  const packageJsonPath = path.join(projectDir, 'package.json');

  const backup = getStoredVersions(projectDir);
  if (!backup) {
    fail('No linked packages found. Nothing to unlink.');
    process.exit(1);
  }

  const packageJson = readJSON(packageJsonPath, { useCache: false });

  // Each backup entry is a task: restore its version (instant, in-memory) or
  // skip if it's no longer file:-linked. The shared runner renders the glyph
  // line + `restored N, skipped M` tally; the single `npm install` that
  // realises the restores runs once, after the list settles.
  const tasks = Object.entries(backup).map(([pkgName, originalVersion]) => ({
    label: pkgName,
    /** @returns {import('../shared/tasks/status').Outcome} */
    run() {
      if (!isLinkedDependency(packageJson, pkgName)) return { kind: 'skipped', detail: 'not linked' };
      if (dryRun) return { kind: 'done', detail: `would restore → ${originalVersion}` };
      if (restorePackageVersionInPlace(packageJson, pkgName, originalVersion)) {
        return { kind: 'done', detail: `→ ${originalVersion}` };
      }
      return { kind: 'skipped', detail: 'no matching dependency' };
    },
  }));

  const report = await runTasks(tasks, { verb: dryRun ? 'would restore' : 'restored' });
  const unlinkedCount = report.done.length;

  if (!dryRun && unlinkedCount > 0) {
    writeJSON(packageJsonPath, packageJson);
    success('Updated package.json');

    log('Installing packages from npm...');
    run(pm, ['install']);
    success('Installed packages from npm');

    cleanupBackup(projectDir);
  } else if (!dryRun) {
    info('No linked packages to unlink');
  }

  return { unlinkedCount };
}

module.exports = {
  storeOriginalVersion,
  getStoredVersions,
  linkPackage,
  unlinkPackages,
};
