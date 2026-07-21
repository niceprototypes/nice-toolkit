/**
 * @fileoverview Logging utilities with consistent formatting and ANSI colors
 *
 * Provides a unified logging interface for nice-toolkit with:
 * - Color-coded output for different message types
 * - Consistent emoji prefixes for visual scanning
 * - Support for terminal environments that don't support colors
 *
 * @module logger
 */

// ──────────────────────────────────────────────────────────────────────────────
// ANSI Color Formatters
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wraps text in ANSI escape codes for cyan color
 * @param {string} s - Text to colorize
 * @returns {string} Cyan-colored text
 * @example
 * console.log(cyan('highlighted')); // Prints in cyan
 */
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

/**
 * Wraps text in ANSI escape codes for gray color (dim)
 * @param {string} s - Text to colorize
 * @returns {string} Gray-colored text
 */
const gray = (s) => `\x1b[90m${s}\x1b[0m`;

/**
 * Wraps text in ANSI escape codes for green color
 * @param {string} s - Text to colorize
 * @returns {string} Green-colored text
 */
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/**
 * Wraps text in ANSI escape codes for red color
 * @param {string} s - Text to colorize
 * @returns {string} Red-colored text
 */
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * Wraps text in ANSI escape codes for yellow color
 * @param {string} s - Text to colorize
 * @returns {string} Yellow-colored text
 */
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// ──────────────────────────────────────────────────────────────────────────────
// Logging Functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Logs a general message with package emoji prefix
 *
 * Use for standard informational messages about package operations.
 *
 * @param {string} msg - Message to log
 * @example
 * log('Scanning for linked packages...');
 * // Output: 📦 Scanning for linked packages...
 */
function log(msg) {
  console.log(`📦 ${msg}`);
}

/**
 * Logs an informational/debug message in gray
 *
 * Use for secondary information, hints, or verbose output.
 *
 * @param {string} msg - Message to log
 * @example
 * info('Detected package manager: npm');
 * // Output: ℹ︎ Detected package manager: npm (in gray)
 */
function info(msg) {
  console.log(gray(`ℹ︎ ${msg}`));
}

/**
 * Logs a success message with green checkmark
 *
 * Use when an operation completes successfully.
 *
 * @param {string} msg - Message to log
 * @example
 * success('Linked nice-react-button successfully');
 * // Output: ✅ Linked nice-react-button successfully (in green)
 */
function success(msg) {
  console.log(green(`✅ ${msg}`));
}

/**
 * Logs a warning message with yellow exclamation
 *
 * Use for non-fatal issues that the user should be aware of.
 *
 * @param {string} msg - Message to log
 * @example
 * warn('Workspaces detected. Consider using workspace: protocol.');
 * // Output: ⚠️  Workspaces detected... (in yellow)
 */
function warn(msg) {
  console.log(yellow(`⚠️  ${msg}`));
}

/**
 * Logs an error message with red X to stderr
 *
 * Use for fatal errors that prevent the operation from completing.
 *
 * @param {string} msg - Message to log
 * @example
 * fail('Path does not exist: ../my-lib');
 * // Output: 💀 Path does not exist: ../my-lib (in red, to stderr)
 */
function fail(msg) {
  console.error(red(`💀 ${msg}`));
}

module.exports = {
  // Colors
  cyan,
  gray,
  green,
  red,
  yellow,

  // Loggers
  log,
  info,
  success,
  warn,
  fail,
};
