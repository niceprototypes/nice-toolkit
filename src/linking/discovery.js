/**
 * @fileoverview Package discovery utilities for finding linked dependencies
 *
 * Provides functions for traversing the dependency tree to find all packages
 * linked via the file: protocol. This is essential for the Nice ecosystem
 * where many packages have interconnected file: dependencies.
 *
 * Key features:
 * - Recursive traversal of file: dependencies
 * - Cycle detection to prevent infinite loops
 * - Caching via fs-utils for performance
 *
 * @module discovery
 */

const path = require('path');
const { readJSON, pathExists } = require('../shared/fs-utils');
const { warn } = require('../shared/logger');

// ──────────────────────────────────────────────────────────────────────────────
// Linked Package Discovery
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the relative path from a file: dependency specifier
 *
 * @param {string} version - Dependency version string (e.g., "file:../my-lib")
 * @returns {string|null} Relative path, or null if not a file: dependency
 *
 * @example
 * extractFilePath("file:../react-button")
 * // => "../react-button"
 *
 * @example
 * extractFilePath("^1.0.0")
 * // => null
 */
function extractFilePath(version) {
  if (typeof version === 'string' && version.startsWith('file:')) {
    return version.slice(5); // Remove 'file:' prefix
  }
  return null;
}

/**
 * Checks if a dependency version is a file: link
 *
 * @param {string} version - Dependency version string
 * @returns {boolean} True if it's a file: dependency
 *
 * @example
 * isFileLink("file:../my-lib") // => true
 * isFileLink("^1.0.0")         // => false
 * isFileLink("workspace:*")    // => false
 */
function isFileLink(version) {
  return typeof version === 'string' && version.startsWith('file:');
}

/**
 * Gets all dependencies from a package.json object
 *
 * Combines both dependencies and devDependencies into a single object.
 * Used for finding all potential file: links.
 *
 * @param {object} pkg - Parsed package.json object
 * @returns {Object<string, string>} Combined dependencies
 *
 * @example
 * getAllDependencies({
 *   dependencies: { react: "^18.0.0" },
 *   devDependencies: { typescript: "^5.0.0" }
 * })
 * // => { react: "^18.0.0", typescript: "^5.0.0" }
 */
function getAllDependencies(pkg) {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
}

/**
 * Recursively finds all packages linked via file: protocol in a project
 *
 * Starting from a project directory, traverses the dependency tree following
 * all file: references to discover every locally linked package. Uses a
 * visited set to prevent infinite loops from circular dependencies.
 *
 * This is particularly important for the Nice ecosystem where packages like
 * nice-react-button depend on nice-react-styles (file:), which depends on
 * nice-styles (file:), etc.
 *
 * Performance notes:
 * - Uses cached package.json reads (via fs-utils)
 * - Early exit on already-visited paths
 * - Returns a Set for O(1) duplicate checking
 *
 * @param {string} projectDir - Root project directory to start from
 * @param {Set<string>} [visited=new Set()] - Set of already visited paths (for recursion)
 * @returns {Set<string>} Set of absolute paths to all linked packages
 *
 * @example
 * // Find all linked packages in a Nice project
 * const linked = findAllLinkedPackages('/path/to/nice-website-2025');
 * // => Set {
 * //   '/path/to/nice-react-button',
 * //   '/path/to/nice-react-styles',
 * //   '/path/to/nice-styles',
 * //   '/path/to/nice-react-ink',
 * //   ...
 * // }
 *
 * @example
 * // Get count of linked packages
 * const linked = findAllLinkedPackages(process.cwd());
 * console.log(`Found ${linked.size} linked packages`);
 */
function findAllLinkedPackages(projectDir, visited = new Set()) {
  const linkedPackages = new Set();
  const absoluteProjectDir = path.resolve(projectDir);

  // Prevent infinite loops from circular dependencies
  if (visited.has(absoluteProjectDir)) {
    return linkedPackages;
  }
  visited.add(absoluteProjectDir);

  // Check if package.json exists
  const pkgJsonPath = path.join(absoluteProjectDir, 'package.json');
  if (!pathExists(pkgJsonPath)) {
    return linkedPackages;
  }

  try {
    const pkg = readJSON(pkgJsonPath);
    const allDeps = getAllDependencies(pkg);

    // Find all file: dependencies
    for (const [name, version] of Object.entries(allDeps)) {
      const relativePath = extractFilePath(version);
      if (!relativePath) continue;

      const absolutePath = path.resolve(absoluteProjectDir, relativePath);

      // Verify the linked package exists and has a package.json
      if (pathExists(absolutePath) && pathExists(path.join(absolutePath, 'package.json'))) {
        linkedPackages.add(absolutePath);

        // Recursively find linked packages in this dependency
        const nestedLinked = findAllLinkedPackages(absolutePath, visited);
        for (const nested of nestedLinked) {
          linkedPackages.add(nested);
        }
      }
    }
  } catch (e) {
    warn(`Could not parse package.json in ${absoluteProjectDir}: ${e.message}`);
  }

  return linkedPackages;
}

/**
 * Reads the package name from a directory's package.json
 *
 * @param {string} dir - Directory containing package.json
 * @returns {string} Package name from package.json
 * @throws {Error} If package.json has no "name" field
 *
 * @example
 * readPkgName('/path/to/nice-react-button')
 * // => 'nice-react-button'
 */
function readPkgName(dir) {
  const pkgJsonPath = path.join(dir, 'package.json');
  const pkg = readJSON(pkgJsonPath);

  if (!pkg.name) {
    throw new Error(`Package at ${dir} has no "name" field in package.json`);
  }

  return pkg.name;
}

/**
 * Validates that a directory contains a valid linkable package
 *
 * Checks for:
 * - Directory existence
 * - package.json presence
 *
 * @param {string} dir - Directory to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 *
 * @example
 * const result = validatePackageDir('/path/to/my-lib');
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 */
function validatePackageDir(dir) {
  const resolvedDir = path.resolve(dir);

  if (!pathExists(resolvedDir)) {
    return { valid: false, error: `Path does not exist: ${resolvedDir}` };
  }

  const pkgJsonPath = path.join(resolvedDir, 'package.json');
  if (!pathExists(pkgJsonPath)) {
    return { valid: false, error: `No package.json found in: ${resolvedDir}` };
  }

  return { valid: true };
}

module.exports = {
  // Utilities
  extractFilePath,
  isFileLink,
  getAllDependencies,

  // Discovery
  findAllLinkedPackages,
  readPkgName,
  validatePackageDir,
};
