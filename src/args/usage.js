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
  nicely <package-path> [options]
  nicely --dedupe [path] [options]
  nicely --watch [options]
  nicely --publish [packages...]

Options:
  --dedupe [path]            ${cyan('Remove')} duplicate singletons (react, styled-components, etc.) from linked packages' node_modules. With a path, scope to just that package; otherwise recurse across all linked packages.
  --clean                    ${cyan('Kill')} dev-server ports + wipe webpack/Vite caches across every consumer
  --no-kill                  Used with ${cyan('--clean')} to skip the port-kill phase (caches only)
  --build-all                ${cyan('Rebuild')} every linked nice-* package's dist in registry tier order
  --build-icons              ${cyan('Rebuild')} nice-icons and its dependents (nice-react-icon, …) in tier order, then --vite — the targeted build after an SVG/icon change
  --convert [path]           With ${cyan('--build-icons')}: convert new/changed .source .ai → svg first; optional .source path scopes it — a folder (brands, brands/github) or a single .ai file (brands/github/fill.ai); omit for all
  --vite                     ${cyan('Refresh')} Vite's optimized-deps cache + bounce dev servers so a rebuilt linked dist is re-bundled (run standalone, or automatically by --build-icons)
  --reset                    ${cyan('Chain')} --build-all → --dedupe → --clean. Use after refactors that touch foundation packages.
  --log                      With ${cyan('--reset')}: write a timestamped build/failure report to {workspace}/.nice/reset-{timestamp}.log
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
                             Example: nicely --bump major "Rename breakpoint identifiers"
  --help, -h                 Show help

Examples:
  nicely --dedupe               Dedupe singletons across all file: linked packages recursively
  nicely --dedupe ../my-lib     Dedupe singletons in only the specified package
  nicely ../my-lib              Link and clean a package
  nicely --dry-run --dedupe     Preview what would be deduped
  nicely --publish              Publish all changed packages to npm
  nicely --publish nice-styles,nice-react-styles  Publish specific packages
  nicely --dev                  Run dev scripts in all linked packages
  nicely --dev --watch          Rebuild packages AND trigger reload on changes
  nicely --watch                Watch dist folders (use with external rebuilder)
  nicely --watch --watch-dir src Watch src/ instead of dist/
  nicely --build-icons          Rebuild nice-icons + dependents after changing an SVG (auto-refreshes Vite)
  nicely --vite                 Force Vite to re-bundle linked dists after an out-of-band rebuild
  nicely --reset                Rebuild all + dedupe + clean (post-refactor recovery)

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
