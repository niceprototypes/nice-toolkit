/**
 * @fileoverview Command-line argument parsing utilities
 *
 * Provides functions for parsing CLI arguments without external dependencies.
 * Handles flag detection, value extraction, and comma-separated list parsing.
 *
 * @module args
 */

const { parseList, getArg, hasFlag, findPositionalArg } = require('./parsers');
const { showUsage } = require('./usage');
const { parseArgs } = require('./parse-args');

module.exports = {
  parseList,
  getArg,
  hasFlag,
  findPositionalArg,
  showUsage,
  parseArgs,
};
