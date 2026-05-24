/**
 * @fileoverview Query service for the Nice ecosystem package registry.
 *
 * Single entry point for reading and querying registry.json. All consumers
 * (publisher, storybook, vite configs) import from this module
 * instead of reading the raw JSON directly.
 *
 * Sub-modules:
 * - constants.js — REGISTRY_PATH, VALID_TYPES, VALID_GROUPS
 * - read.js      — readRegistry, validateEntry
 * - query.js     — getAllPackages, getPackageNames, getTiers, getTierIndexMap, getByType, getByGroup, getLinkedPackageMap, getSourceAliasableNames
 *
 * @module registry
 */

const { REGISTRY_PATH, VALID_TYPES, VALID_GROUPS } = require('./constants');
const { readRegistry, validateEntry } = require('./read');
const {
  getAllPackages,
  getPackageNames,
  getTiers,
  getTierIndexMap,
  getByType,
  getByGroup,
  getLinkedPackageMap,
  getSourceAliasableNames,
} = require('./query');

module.exports = {
  // Constants
  REGISTRY_PATH,
  VALID_TYPES,
  VALID_GROUPS,

  // Core
  readRegistry,
  validateEntry,

  // Query
  getAllPackages,
  getPackageNames,
  getTiers,
  getTierIndexMap,
  getByType,
  getByGroup,
  getLinkedPackageMap,
  getSourceAliasableNames,
};
