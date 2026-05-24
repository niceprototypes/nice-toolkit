/**
 * @fileoverview Main CLI argument parser
 *
 * Composes the low-level token helpers and the private bump-message
 * helper into a single `parseArgs` entry point that returns a fully
 * structured options object.
 *
 * @module args/parse-args
 */

const { parseList, getArg, hasFlag, findPositionalArg } = require('./parsers');
const { findBumpMessage } = require('./bump-message');

/**
 * Parsed command-line options
 * @typedef {object} ParsedOptions
 * @property {string[]} packagesToRemove - Packages to remove from node_modules
 * @property {boolean} dryRun - Preview mode, don't make changes
 * @property {boolean} dedupe - Dedupe singletons across all linked packages recursively
 * @property {boolean} clean - Kill dev-server ports + wipe consumer caches
 * @property {boolean} reset - Chain --build-all → --dedupe → --clean in sequence
 * @property {boolean} unlink - Restore original versions
 * @property {boolean} dev - Run dev scripts in all linked packages
 * @property {boolean} watch - Watch linked packages for changes
 * @property {string} watchDir - Directory to watch in each package
 * @property {boolean} skipPeerCheck - Skip peer dependency enforcement
 * @property {string} pm - Package manager to use
 * @property {string|undefined} pkgPath - Path to package to link/clean
 * @property {boolean} showHelp - Whether to show help
 */

/**
 * Parses command-line arguments into a structured options object
 *
 * @param {string[]} args - Raw command-line arguments
 * @param {object} defaults - Default configuration
 * @param {string[]} defaults.conflictingPackages - Default packages to remove
 * @param {string} defaults.pm - Default package manager
 * @returns {ParsedOptions} Parsed options
 */
function parseArgs(args, { conflictingPackages, pm: defaultPM }) {
  // Check for help flag first
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    return { showHelp: true };
  }

  // Build the list of packages to remove
  let packagesToRemove = [...conflictingPackages];
  const exclude = getArg(args, '--exclude');
  if (exclude) {
    packagesToRemove = parseList(exclude);
  }
  const addExclude = getArg(args, '--add-exclude');
  if (addExclude) {
    const additional = parseList(addExclude);
    packagesToRemove = [...new Set([...packagesToRemove, ...additional])];
  }

  // Parse flags
  const forcedPM = getArg(args, '--manager');
  const watchDir = getArg(args, '--watch-dir');

  // Find positional argument (package path)
  const flagsWithValues = new Set(['--exclude', '--add-exclude', '--manager', '--watch-dir', '--publish', '--bump']);
  const pkgPath = findPositionalArg(args, flagsWithValues);

  // --bump {level} "{message}" — append an entry to .nice/bump.md in the
  // current package. The value of --bump is the level; the message is the
  // first positional after the flag.
  const bumpLevel = getArg(args, '--bump');
  const bumpMessage = bumpLevel ? findBumpMessage(args) : null;

  return {
    packagesToRemove,
    dryRun: hasFlag(args, '--dry-run'),
    publish: hasFlag(args, '--publish'),
    publishPackages: getArg(args, '--publish'),
    noNpm: hasFlag(args, '--no-npm'),
    dryPublish: hasFlag(args, '--dry-publish'),
    dedupe: hasFlag(args, '--dedupe'),
    clean: hasFlag(args, '--clean'),
    noKill: hasFlag(args, '--no-kill'),
    buildAll: hasFlag(args, '--build-all'),
    reset: hasFlag(args, '--reset'),
    unlink: hasFlag(args, '--unlink'),
    dev: hasFlag(args, '--dev'),
    watch: hasFlag(args, '--watch'),
    watchDir: watchDir || 'dist',
    skipPeerCheck: hasFlag(args, '--skip-peer-check'),
    pm: forcedPM || defaultPM,
    forcedPM: Boolean(forcedPM),
    pkgPath,
    bumpLevel,
    bumpMessage,
    showHelp: false,
  };
}

module.exports = {
  parseArgs,
};
