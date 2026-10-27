[2026-09-19 07:59] patch: Register nice-storybook-theme and nice-storybook-navigation in the build tier list, as a tier of their own after every package they consume.
[2026-09-24 18:54] patch: Stop injecting a prepare script into linked packages during link and dedupe; register nice-react-popover (tier 2) and nice-react-field (tier 3) and move nice-react-tooltip to tier 3 above its new popover dependency
[2026-09-24 19:00] patch: Publish and build foundation (tier-0) packages first instead of last
[2026-09-24 19:47] minor: Prompt for graph-resolved dependents that have bump notes or have never been published instead of auto-patching them, ship first publishes at their local version, and drop dependents of a skipped never-published package
[2026-09-25 18:51] patch: Register nice-storybook-spinner in the Storybook addons tier
[2026-09-25 19:08] minor: Rewrite nice-* peer ranges to the new versions of packages published in the same run, restore them afterwards, and count peerDependencies as dependency-graph edges
[2026-09-26 17:48] minor: Publish runs npm asynchronously with a per-package timeout (--publish-timeout <s>, default 120s), surfaces npm auth URLs/prompts live, and restores package.json swaps on SIGHUP/SIGINT/SIGTERM/exit (SIGINT restore was pre-empted by heart-spinner's exit)
[2026-10-08 22:00] minor: nicely develop starts each watcher after its nice-* dependencies' first build and shows a live tree (newest step per package, elapsed time, build time and dist/ size, pinned errors); --verbose lists build steps, --raw prints every watcher line
[2026-10-08 22:00] minor: Watchers never outlive nicely develop: each runs in its own process group under a watchdog, recorded in {workspace}/.nice/develop.pids and stopped on the next start; add nicely develop --stop; stopping warns about packages left without build output
[2026-10-08 22:00] patch: nicely build icons and nicely reset stop a running nicely develop through its recorded watcher groups instead of a process scan
[2026-10-08 22:00] patch: Register nice-config-vite, nice-config-crxjs, nice-react-line, nice-react-toggle, nice-react-tabs, nice-react-checkbox and nice-react-logo in the build tier list
[2026-10-14 19:34] patch: Register nice-react-dialog in the build tier list
[2026-10-15 15:38] patch: Report CLI errors through the shared logger instead of crashing with Cannot find module './src/logger'
