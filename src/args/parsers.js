/**
 * @fileoverview Low-level CLI token helpers
 *
 * Primitive functions for inspecting a raw `args` array: splitting
 * comma-lists, reading flag values, checking for boolean flags, and
 * finding positional arguments.
 *
 * @module args/parsers
 */

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

module.exports = {
  parseList,
  getArg,
  hasFlag,
  findPositionalArg,
};
