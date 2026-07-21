/**
 * @fileoverview Help/usage text for the nice-toolkit CLI (`nicely`)
 *
 * @module args/usage
 */

const { cyan, gray } = require('../shared/logger');

/**
 * Print the usage help for the `nicely <verb> [targets] [--flags]` grammar.
 *
 * @returns {void}
 */
function showUsage() {
  console.log(`
${cyan('nicely')} — the link · build · publish CLI for the file:-linked nice-* workspace

Usage:
  nicely <command> [targets…] [--flags]

Commands:
  ${cyan('link')} <path>            Link a package into the workspace via file:
  ${cyan('unlink')}                 Restore packages to their original npm versions
  ${cyan('publish')} [targets]      Publish to npm with the dependency cascade (default: changed)
  ${cyan('build')} [targets]        Rebuild dists in tier order (default: all)
  ${cyan('dedupe')} [path]          Remove duplicate singletons from linked packages (default: all)
  ${cyan('clean')} [--vite]         Kill dev servers + wipe consumer caches
  ${cyan('reset')}                  build → dedupe → clean (post-refactor recovery)
  ${cyan('develop')}                Rebuild + reload loop across linked packages
  ${cyan('bump')} <level> <message> Record a bump-intent entry in ./.nice/bump.md
  ${cyan('help')}, --help, -h       Show this help

Targets (for ${cyan('publish')} / ${cyan('build')}):
  ${gray('all')}                    every registered package, in tier order
  ${gray('icons')}                  a named group (nice-icons + its dependents)
  ${gray('<name> <name> …')}        specific packages, space-separated
  ${gray('--changed')}             (publish) only packages with changes

Flags:
  --dry-run                Preview without making changes (every mutating command)
  --changed                publish: restrict to the changed set
  --no-npm                 publish: bump/build/commit/push but skip npm publish
  --vite                   clean: only Vite's optimized-deps cache (bounce servers)
  --no-kill                clean/build/reset: skip the dev-server port-kill
  --convert [path]         build icons: convert new .source .ai → svg first (folder / .ai / all)
  --log                    reset: write a timestamped build report to {workspace}/.nice/
  --no-reload              dev: rebuild only (no reload trigger)
  --reload-only            dev: reload trigger only (for an external rebuilder)
  --dir <dir>              dev: directory watched in each package (default: dist)
  --exclude <a,b,c>        link/dedupe: singleton-removal list (overrides defaults)
  --add-exclude <a,b,c>    link/dedupe: extend the removal list
  --skip-peer-check        link/dedupe/reset: don't auto-move react → peerDependencies
  --manager <npm|yarn|pnpm> Force a package manager (auto-detected by default)

Examples:
  nicely link ../my-lib                         Link and clean a package
  nicely publish                                Publish all changed packages
  nicely publish nice-icons nice-react-icon     Publish specific packages
  nicely publish all                            Publish every package
  nicely publish --dry-run                      Preview the publish plan
  nicely build all                              Rebuild every dist in tier order
  nicely build icons                            Rebuild nice-icons + dependents, refresh Vite
  nicely build icons --convert                  …converting new .source .ai first
  nicely dedupe                                 Dedupe singletons across all linked packages
  nicely dedupe ../my-lib                       Dedupe a single package
  nicely clean                                  Kill dev servers + wipe caches
  nicely clean --vite                           Bounce only Vite's optimized-deps cache
  nicely reset --dry-run                        Preview build → dedupe → clean
  nicely develop                                Rebuild + reload loop (the common setup)
  nicely bump minor "Add spacing prop"          Record a bump intent

Notes:
  ${cyan('dedupe')} finds file: dependencies recursively and removes duplicate singletons
  (react, styled-components, …) from each — the fix for "multiple copies of React".
  Conflicts are removed from the ${cyan('LINKED PACKAGE')} node_modules, not your app; list
  React as a peerDependency in your library. For CRA: export NODE_OPTIONS=--preserve-symlinks
`);
}

module.exports = {
  showUsage,
};
