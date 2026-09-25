[2026-09-19 07:59] patch: Register nice-storybook-theme and nice-storybook-navigation in the build tier list, as a tier of their own after every package they consume.
[2026-09-24 18:54] patch: Stop injecting a prepare script into linked packages during link and dedupe; register nice-react-popover (tier 2) and nice-react-field (tier 3) and move nice-react-tooltip to tier 3 above its new popover dependency
[2026-09-24 19:00] patch: Publish and build foundation (tier-0) packages first instead of last
[2026-09-24 19:47] minor: Prompt for graph-resolved dependents that have bump notes or have never been published instead of auto-patching them, ship first publishes at their local version, and drop dependents of a skipped never-published package
[2026-09-25 18:51] patch: Register nice-storybook-spinner in the Storybook addons tier
