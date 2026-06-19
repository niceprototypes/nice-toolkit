[2026-06-02 20:28] patch: Register nice-react-form in the package registry
[2026-06-12 19:21] patch: --build-all prints a per-package built/skipped/failed list with skip/fail reasons after the summary
[2026-06-19 18:52] minor: --reset now terminates any running `ntk --dev`/`--watch` first (SIGTERM, then SIGKILL on stragglers) so their rollup watchers do not race the rebuild or have node_modules mutated under them
