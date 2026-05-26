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
 * **`@types/*` are intentionally excluded.** Type packages have no runtime
 * presence — removing them only suppresses build-time tsc resolution and
 * causes cascading TS7031 implicit-`any` and TS2875 `react/jsx-runtime`
 * warnings during `ntk --build-all`. The runtime singleton concern is
 * about the `react` / `react-dom` JS modules themselves, not their type
 * definitions. Power users with cross-version type-skew issues can opt
 * in via `ntk --add-exclude @types/react,@types/react-dom`.
 *
 * @constant {string[]}
 * @description Package categories:
 *   - **React core**: react, react-dom, scheduler, react-is
 *   - **Styling**: styled-components, @emotion/react, @emotion/styled
 *
 * @example
 * // Override with --exclude flag
 * ntk --exclude react,react-dom ../my-lib
 *
 * @example
 * // Extend with --add-exclude flag
 * ntk --add-exclude zustand,jotai ../my-lib
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
];

/**
 * Packages that should be automatically moved to peerDependencies in the linked package.
 *
 * When a package has these in `dependencies`, they are moved to `peerDependencies`
 * to ensure the linked package uses the host project's version instead of its own.
 *
 * This is particularly important for the Nice ecosystem where all packages
 * (nice-react-button, nice-react-typography, etc.) should share the same
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
