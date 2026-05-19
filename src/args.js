/**
 * @fileoverview Command-line argument parsing utilities
 *
 * Provides functions for parsing CLI arguments without external dependencies.
 * Handles flag detection, value extraction, and comma-separated list parsing.
 *
 * @module args
 */

const { cyan } = require('./shared/logger');

// ──────────────────────────────────────────────────────────────────────────────
// Argument Parsing
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parses a comma-separated string into an array of trimmed, non-empty values
 *
 * Handles various input formats gracefully:
 * - Extra whitespace is trimmed
 * - Empty segments are filtered out
 * - Works with or without spaces after commas
 *
 * @param {string} s - Comma-separated string (e.g., "react,react-dom,styled-components")
 * @returns {string[]} Array of trimmed package names
 *
 * @example
 * parseList("react, react-dom, styled-components")
 * // => ["react", "react-dom", "styled-components"]
 *
 * @example
 * parseList("react,react-dom,")
 * // => ["react", "react-dom"] (trailing comma handled)
 *
 * @example
 * parseList("  react  ,  react-dom  ")
 * // => ["react", "react-dom"] (whitespace trimmed)
 */
function parseList(s) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Gets the value of a command-line argument by flag name
 *
 * Searches for the flag in the args array and returns the next element
 * as its value. Returns null if the flag is not found.
 *
 * @param {string[]} args - Command-line arguments array
 * @param {string} name - Flag name to search for (e.g., "--exclude")
 * @returns {string|null} Value following the flag, or null if not found
 *
 * @example
 * getArg(["--exclude", "react", "--dry-run"], "--exclude")
 * // => "react"
 *
 * @example
 * getArg(["--dry-run"], "--exclude")
 * // => null (flag not found)
 *
 * @example
 * getArg(["--manager", "pnpm"], "--manager")
 * // => "pnpm"
 */
function getArg(args, name) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : null;
}

/**
 * Checks if a flag is present in the arguments array
 *
 * @param {string[]} args - Command-line arguments array
 * @param {string} name - Flag name to check for
 * @returns {boolean} True if flag is present
 *
 * @example
 * hasFlag(["--dry-run", "../my-lib"], "--dry-run")
 * // => true
 */
function hasFlag(args, name) {
  return args.includes(name);
}

/**
 * Finds the first positional argument (non-flag argument)
 *
 * Skips over flags and their values to find the package path.
 * This allows flexible argument ordering.
 *
 * @param {string[]} args - Command-line arguments array
 * @param {Set<string>} [flagsWithValues] - Set of flag names that take values
 * @returns {string|undefined} First positional argument, or undefined if none
 *
 * @example
 * // Standard usage
 * findPositionalArg(["../my-lib", "--dry-run"])
 * // => "../my-lib"
 *
 * @example
 * // Flags before path
 * const flagsWithValues = new Set(["--exclude", "--add-exclude", "--manager"]);
 * findPositionalArg(["--exclude", "react", "../my-lib"], flagsWithValues)
 * // => "../my-lib"
 */
function findPositionalArg(args, flagsWithValues = new Set()) {
  return args.find((arg, i) => {
    // Skip flags
    if (arg.startsWith('--')) return false;

    // Skip values that belong to flags
    const prevArg = args[i - 1];
    if (prevArg && flagsWithValues.has(prevArg)) return false;

    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Help/Usage Display
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Displays the usage help text with all available options
 *
 * Shows:
 * - Command syntax and examples
 * - Available flags with descriptions
 * - Notes about usage patterns
 *
 * @returns {void}
 */
function showUsage() {
  console.log(`
${cyan('nice-toolkit')}

Usage:
  ntk <package-path> [options]
  ntk --dedupe [path] [options]
  ntk --watch [options]
  ntk --publish [packages...]

Options:
  --dedupe [path]            ${cyan('Remove')} duplicate singletons (react, styled-components, etc.) from linked packages' node_modules. With a path, scope to just that package; otherwise recurse across all linked packages.
  --clean                    ${cyan('Kill')} dev-server ports + wipe webpack/Vite caches across every consumer
  --no-kill                  Used with ${cyan('--clean')} to skip the port-kill phase (caches only)
  --build-all                ${cyan('Rebuild')} every linked nice-* package's dist in registry tier order
  --unlink                   Restore npm packages to their original versions
  --dev                      ${cyan('Run')} dev scripts in all linked packages (rebuilds on change)
  --watch                    ${cyan('Watch')} linked package dist folders and trigger reload on change
  --watch-dir <dir>          Directory to watch in each package (default: 'dist')
  --exclude <a,b,c>          Comma-separated list of packages to remove (overrides defaults)
  --add-exclude <a,b,c>      Comma-separated list of additional packages to remove
  --dry-run                  Show what would happen without making changes
  --manager <npm|yarn|pnpm>  Force a package manager (auto-detected by default)
  --skip-peer-check          Do not auto-move react/react-dom to peerDependencies
  --create <name>            Create a new Nice ecosystem package
  --type <component>         Package type for --create (default: component)
  --publish [pkg1,pkg2,...]  Publish changed packages to npm (all if no packages specified)
  --no-npm                   Bump, build, commit, push — but skip npm publish
  --dry-publish              Preview what would be published without making changes
  --bump <level> <message>   Record a bump intent entry in ./.nice/bump.md
                             level: major | minor | patch
                             Example: ntk --bump major "Rename breakpoint identifiers"
  --help, -h                 Show help

Examples:
  ntk --dedupe               Dedupe singletons across all file: linked packages recursively
  ntk --dedupe ../my-lib     Dedupe singletons in only the specified package
  ntk ../my-lib              Link and clean a package
  ntk --dry-run --dedupe     Preview what would be deduped
  ntk --publish              Publish all changed packages to npm
  ntk --publish nice-styles,nice-react-styles  Publish specific packages
  ntk --dev                  Run dev scripts in all linked packages
  ntk --dev --watch          Rebuild packages AND trigger reload on changes
  ntk --watch                Watch dist folders (use with external rebuilder)
  ntk --watch --watch-dir src Watch src/ instead of dist/

Notes:
  ${cyan('--dedupe')} finds all file: dependencies recursively and removes duplicate
  singletons (react, styled-components, etc.) from each. This is the recommended
  way to resolve "multiple copies of React" errors when working with linked
  Nice ecosystem packages.

  ${cyan('--dev')} runs 'npm run dev' in all linked packages concurrently,
  rebuilding them when source files change.

  ${cyan('--watch')} watches linked package dist folders and touches a trigger
  file when changes are detected, causing webpack/CRA to recompile.

  ${cyan('--dev --watch')} combines both: rebuilds packages AND triggers reload.
  This is the recommended setup for webpack/CRA projects.

  Conflicts are removed from the ${cyan('LINKED PACKAGE')} node_modules, not your app.
  Ensure your component library lists React as peerDependency.

  For CRA projects, you may need: export NODE_OPTIONS=--preserve-symlinks
`);
}

/**
 * Parsed command-line options
 * @typedef {object} ParsedOptions
 * @property {string[]} packagesToRemove - Packages to remove from node_modules
 * @property {boolean} dryRun - Preview mode, don't make changes
 * @property {boolean} dedupe - Dedupe singletons across all linked packages recursively
 * @property {boolean} clean - Kill dev-server ports + wipe consumer caches
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
  const flagsWithValues = new Set(['--exclude', '--add-exclude', '--manager', '--watch-dir', '--publish', '--create', '--type', '--bump']);
  const pkgPath = findPositionalArg(args, flagsWithValues);

  // --bump {level} "{message}" — append an entry to .nice/bump.md in the
  // current package. The value of --bump is the level; the message is the
  // first positional after the flag.
  const bumpLevel = getArg(args, '--bump');
  const bumpMessage = bumpLevel ? findBumpMessage(args) : null;

  return {
    packagesToRemove,
    dryRun: hasFlag(args, '--dry-run'),
    create: getArg(args, '--create'),
    createType: getArg(args, '--type') || 'component',
    publish: hasFlag(args, '--publish'),
    publishPackages: getArg(args, '--publish'),
    noNpm: hasFlag(args, '--no-npm'),
    dryPublish: hasFlag(args, '--dry-publish'),
    dedupe: hasFlag(args, '--dedupe'),
    clean: hasFlag(args, '--clean'),
    noKill: hasFlag(args, '--no-kill'),
    buildAll: hasFlag(args, '--build-all'),
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

/**
 * Collects the message for `--bump <level> <message...>`. Everything after
 * `--bump <level>` that is not a flag becomes the message, joined by spaces.
 *
 * @param {string[]} args - Raw CLI arguments
 * @returns {string|null} The joined message, or null if none provided
 */
function findBumpMessage(args) {
  const idx = args.indexOf('--bump');
  if (idx === -1) return null;
  // Skip --bump and its level value; collect positionals until next flag
  const parts = [];
  for (let i = idx + 2; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    parts.push(args[i]);
  }
  const joined = parts.join(' ').trim();
  return joined || null;
}

module.exports = {
  parseList,
  getArg,
  hasFlag,
  findPositionalArg,
  showUsage,
  parseArgs,
};
