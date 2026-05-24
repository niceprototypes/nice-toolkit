/**
 * @fileoverview Help/usage text for the nice-toolkit CLI
 *
 * @module args/usage
 */

const { cyan } = require('../shared/logger');

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

module.exports = {
  showUsage,
};
