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
 * Gets every consecutive value following a flag, up to the next flag (a token
 * starting with `-`) or the end of the args. The multi-value companion to
 * {@link getArg} — for flags that take a list, e.g.
 * `--convert carat-top carat-bottom carat-left`. Returns `[]` when the flag is
 * absent or bare (`--convert` with nothing after it).
 *
 * @param {string[]} args - Command-line arguments array
 * @param {string} name - Flag name to search for (e.g., "--convert")
 * @returns {string[]} Values following the flag, in order
 *
 * @example
 * getMultiArg(["--convert", "carat-top", "carat-left", "--dry-run"], "--convert")
 * // => ["carat-top", "carat-left"]
 */
function getMultiArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return [];
  const values = [];
  for (let i = index + 1; i < args.length && !args[i].startsWith('-'); i++) {
    values.push(args[i]);
  }
  return values;
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

/**
 * Finds every positional argument (non-flag, non-flag-value), in order.
 *
 * The plural companion to {@link findPositionalArg} — used for subcommand
 * targets, where a verb may be followed by several package names
 * (`nicely publish nice-icons nice-react-icon`).
 *
 * @param {string[]} args - Command-line arguments array (already past the verb)
 * @param {Set<string>} [flagsWithValues] - Flag names that consume the next token
 * @param {Set<string>} [multiValueFlags] - Flag names that consume every token
 *   after them up to the next flag (e.g. `--convert a b c`); their whole value
 *   run is excluded from the positionals.
 * @returns {string[]} All positional tokens, in order
 */
function findPositionalArgs(args, flagsWithValues = new Set(), multiValueFlags = new Set()) {
  const positionals = [];
  let inMultiValueRun = false;
  args.forEach((arg, i) => {
    if (arg.startsWith('-')) {
      // A flag ends any prior multi-value run and starts a new one only when it
      // is itself a list-consuming flag.
      inMultiValueRun = multiValueFlags.has(arg);
      return;
    }
    if (inMultiValueRun) return; // token inside a multi-value flag's value run
    const prevArg = args[i - 1];
    if (prevArg && flagsWithValues.has(prevArg)) return; // single-value flag's value
    positionals.push(arg);
  });
  return positionals;
}

module.exports = {
  parseList,
  getArg,
  getMultiArg,
  hasFlag,
  findPositionalArg,
  findPositionalArgs,
};
