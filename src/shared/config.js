/**
 * @fileoverview Configuration constants for nice-toolkit
 *
 * This module defines the default packages that commonly cause conflicts when
 * linking React component libraries, particularly in the Nice ecosystem where
 * all packages share React and styled-components as peer dependencies.
 *
 * @module config
 */

/**
 * Default list of packages that commonly cause conflicts when linking React component libraries.
 *
 * These packages are removed from the linked package's node_modules to prevent
 * duplicate instances that cause runtime errors like:
 * - "Invalid hook call" (multiple React instances)
 * - "Cannot read properties of null reading 'useContext'" (styled-components context mismatch)
 * - "Multiple instances of styled-components detected" (theming issues)
 *
 * **`@types/react` / `@types/react-dom` are included.** A duplicate physical
 * copy gives TypeScript two distinct `FC` identities and breaks declaration
 * emit (TS2883). Removing them from a linked package means its own tsc and
 * jest resolve React and its types from the workspace root
 * (`~/nice/node_modules`, installed from `~/nice/package.json`), which dedupe
 * never touches.
 *
 * @constant {string[]}
 * @description Package categories:
 *   - **React core**: react, react-dom, scheduler, react-is
 *   - **Styling**: styled-components, @emotion/react, @emotion/styled
 *   - **React types**: @types/react, @types/react-dom
 *
 * @example
 * // Override with --exclude flag
 * nicely --exclude react,react-dom ../my-lib
 *
 * @example
 * // Extend with --add-exclude flag
 * nicely --add-exclude zustand,jotai ../my-lib
 */
const DEFAULT_CONFLICTING_PACKAGES = [
  // React core - must be singleton for hooks to work
  'react',
  'react-dom',
  'scheduler',
  'react-is',

  // Styling libraries - context-dependent, must be singleton
  'styled-components',
  '@emotion/react',
  '@emotion/styled',

  // React type packages - a duplicate physical copy (even at the same version)
  // gives TypeScript two distinct `FC` identities, so @rollup/plugin-typescript
  // fails to emit a component's declaration (TS2883 "inferred type cannot be
  // named"), which then breaks the dts bundle. Must be deduped like react itself.
  '@types/react',
  '@types/react-dom',
];

/**
 * Packages that should be automatically moved to peerDependencies in the linked package.
 *
 * When a package has these in `dependencies`, they are moved to `peerDependencies`
 * to ensure the linked package uses the host project's version instead of its own.
 *
 * This is particularly important for the Nice ecosystem where all packages
 * (nice-react-button, nice-react-ink, etc.) should share the same
 * React and styled-components instances with the consuming application.
 *
 * @constant {string[]}
 * @description
 *   - **react/react-dom**: Required for hooks to work correctly
 *   - **styled-components**: Required for ThemeProvider context sharing
 *
 * @see https://nodejs.org/api/packages.html#peer-dependencies
 */
const PEER_ENFORCE = [
  'react',
  'react-dom',
  'styled-components', // Added: All Nice packages use styled-components
];

/**
 * Directory name for storing backup files (original versions before linking)
 * @constant {string}
 */
const BACKUP_DIR_NAME = '.nice-toolkit';

/**
 * Filename for the linked packages backup JSON
 * @constant {string}
 */
const BACKUP_FILE_NAME = 'linked-packages.json';

module.exports = {
  DEFAULT_CONFLICTING_PACKAGES,
  PEER_ENFORCE,
  BACKUP_DIR_NAME,
  BACKUP_FILE_NAME,
};
