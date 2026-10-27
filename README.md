# nice-toolkit

A utility to streamline the npm linking process for React component libraries when working locally, automatically removing conflicting peer dependencies that cause "Invalid hook call" errors, duplicate React instances, and styled-components context issues.

CLI binaries: `nice-toolkit` (long-form) and `nicely` (short alias).

## The Story: Why This Tool Exists

You're developing a React component library. You run `npm link` to test it locally in your app. Everything seems fine until you refresh the page and see:

```
Error: Invalid hook call. Hooks can only be called inside the body of a function component.
```

You check your code - the hooks are definitely inside a component. You search Stack Overflow. You clear caches. You reinstall node_modules. Nothing works.

**The real problem?** When you `npm link` your component library, it brings along its own `node_modules` folder containing its own copy of React. Now you have **two separate React instances** running in your app - one from your app's `node_modules/react` and one from your linked library's `node_modules/react`. React detects this and throws the "Invalid hook call" error because components from one React instance are trying to use hooks managed by a different React instance.

This isn't just a React problem - `styled-components`, `@emotion/react`, and similar libraries have the same issue because they maintain global state and use React Context internally. Multiple instances = broken context = cryptic errors.

The "solution" everyone suggests? Manually delete React from your linked package's `node_modules`, link again, remember to do this every time you reinstall, and hope you don't forget. That's tedious and error-prone.

**`nice-toolkit` automates this entire process.** It removes the conflicting packages from your linked library's `node_modules`, ensures React and friends are listed as peerDependencies, and handles the linking - all in one command.

## Why Symlinks Cause Duplicate React Instances

When you use `npm link`, here's what actually happens:

```
your-app/
├── node_modules/
│   ├── react@18.0.0                    ← Your app's React
│   └── my-component → /Users/you/my-component/  ← Symlink!

/Users/you/my-component/
└── node_modules/
    └── react@18.0.0                    ← DUPLICATE React instance!
```

When `my-component` does `import React from 'react'`, Node.js resolves it **relative to the symlink's target location** (`/Users/you/my-component/`), not your app's location. It finds `/Users/you/my-component/node_modules/react` first - a completely separate React instance from the one in your app.

**Why doesn't this happen with regular (non-linked) dependencies?** Because npm hoists them:

```
your-app/
├── node_modules/
│   ├── react@18.0.0                    ← ONE shared React instance
│   ├── my-component@1.0.0/             ← Regular dependency (NOT a symlink)
│   │   └── (no node_modules here - uses hoisted React above)
│   └── other-library@2.0.0/
│       └── (no node_modules here - uses hoisted React above)
```

All packages resolve to the same React instance at the top level. With symlinks, this hoisting doesn't work because each symlinked package resolves modules from its own location.

## Which Packages Need to Be Singletons?

Not all duplicate packages cause problems - only those that maintain **global state** or use **object identity checks**:

**Must be singleton (nice-toolkit removes these):**
- `react` - maintains a global Fiber tree and hook state
- `react-dom` - maintains a global DOM renderer
- `styled-components` - maintains a global StyleSheet registry and uses React Context
- `@emotion/react` - maintains a global emotion cache
- `scheduler` - global task queue used by React
- `react-is` - used for type checking by React internals

**Can have duplicates (your component libraries):**
- `nice-react-button` - just exports functions/components
- `lodash` - just pure utility functions
- Most regular npm packages - they're stateless code

This is why you can have multiple versions of your own component libraries in `node_modules` without issues, but multiple React instances break everything.

## Solution

`nice-toolkit` solves this by:

1. **Removing conflicting singleton packages** - Deletes React, React DOM, styled-components, and their TypeScript definitions from the linked package's `node_modules`
2. **Enforcing peerDependencies** - Ensures React and friends are listed as peerDependencies so they use your app's versions
3. **Simple CLI interface** - One command handles everything automatically

## Installation

### Global Installation (Recommended)

```bash
npm install -g nice-toolkit
```

### Local Installation

```bash
npm install nice-toolkit
npx nice-toolkit --help
```

## Usage

### Link a Component Package

```bash
# From your main project directory
nice-toolkit ../nice-react-button

# Or with absolute path
nice-toolkit /Users/username/Code/nice-react-button
```

### Dedupe Only (Remove Conflicting Packages)

```bash
# Remove default packages only
nice-toolkit --dedupe

# Remove custom packages only
nice-toolkit --dedupe --exclude @mui/material,@mui/icons-material

# Add extra packages to default list
nice-toolkit --dedupe --add-exclude @emotion/react,@emotion/styled
```

### Custom Package Exclusion

```bash
# Override default packages with custom list
nice-toolkit --exclude react,react-dom ../nice-react-button

# Add additional packages to the default exclusion list
nice-toolkit --add-exclude @emotion/react,@emotion/styled ../nice-react-button

# Combine both (removes only react, react-dom, and @mui packages)
nice-toolkit --exclude react,react-dom --add-exclude @mui/material ../nice-react-button
```

### Help

```bash
nice-toolkit --help
```

## What It Does

1. **Removes conflicting packages** from your `node_modules`:
   - Default packages removed:
     - `react`
     - `react-dom`
     - `styled-components`
     - `@types/react`
     - `@types/react-dom`
   - Or your custom list of packages using `--exclude`
   - Or default packages plus your additions using `--add-exclude`

2. **Creates npm link** in the target package directory

3. **Links the package** to your current project

4. **Provides feedback** on each step with clear success/error messages

## Example Workflow

```bash
# In your main project (e.g., helpshelf-ui)
cd /path/to/helpshelf-ui

# Link your button component
nice-toolkit ../nice-react-button

# Now you can import and use the component
# Changes to nice-react-button will be reflected immediately
```

## Advanced Usage Examples

### Working with Monorepos

```bash
# Link a package from a monorepo workspace
nice-toolkit ../my-monorepo/packages/ui-components

# Force a specific package manager in a monorepo
nice-toolkit --manager pnpm ../my-monorepo/packages/ui-components
```

### Development Workflow with Watch Mode

```bash
# 1. Link the package
nice-toolkit ../nice-react-button

# 2. In the linked package directory, start watch mode
cd ../nice-react-button
npm run dev  # or npm run build:watch

# 3. In your main project, start your dev server with symlink support
cd /path/to/your-app
NODE_OPTIONS=--preserve-symlinks npm start

# Now changes in nice-react-button will auto-rebuild and appear in your app!
```

### `nicely develop` startup order

`nicely develop` runs every linked package's `dev` watcher, dependencies first: a watcher starts
only after the nice-* packages it depends on (its package.json `dependencies`,
`devDependencies` and `peerDependencies`, among the packages being run) have finished their
first build, so it never reads their types while they are being written (e.g.
storybook-navigation's tsup DTS step failing with TS2307). nice-config-rollup no longer empties
`dist/` on start; tsup's `clean` still does, so the order stays as the safeguard.

- Packages whose dependencies are done start together.
- First build done: rollup's "waiting for changes", tsc's "Watching for file changes", or, for
  tsup and the icons generator, every started build finished and 1.5s of quiet.
- A dependency whose first build fails, exits or takes over 3 minutes still releases its
  dependents, with a warning. A dependency cycle starts its members together.

### `nicely develop` output

In a terminal, `nicely develop` draws a live tree, redrawn in place:

- A header: the package count, how many are building, start progress (then "all built once
  in Xs"), the reload count and the last reload.
- One row per package: ♥ building, with the time since its build started (the same start as
  the ✓ row's duration) and its newest step summarized
  (`♥ storybook-navigation  1.2s · ⠦ Building type declarations`, the time white while it
  counts, then yellow over 8s and red over 20s; `--raw` shows the tools' own
  lines), ✓ ready (the last build's
  duration and the package's `dist/` size, every file in it: `✓ react-button  1.2s · 185.0 KB`;
  each turns yellow over 8s / 512 KB and red over 20s / 2 MB),
  ⚠ warning count, ✗ failed (its first error) or exited (its exit code),
  · queued (`Waiting for react-styles, and 2 others`: the first dependency it waits for and
  how many more; `Queued` once none are left).
- A failed package's diagnostics (every line from its first error on, stack frames aside), pinned under the
  tree until its next successful build. On a short terminal, ready rows collapse to one
  line and long diagnostics are cut.

Errors are rollup's `[!]` / `RollupError`, tsup's `Build failed`, `error TS…` lines, tsc's
`Found N errors`, and a watcher process that exits. Outside a terminal (CI, a pipe), it prints
one line per change instead: a batch starting, a build finished (✓/⚠/✗, failures with their
diagnostics in full), a reload.

`nicely develop --verbose` lists each building package's steps under its row
(`♥ storybook-navigation  1.2s · Building`). When a package
finishes, its row and every step of the build are printed once above the tree, where they stay
in the scrollback; the tree keeps what is still building or failed.

`nicely develop --raw` prints every watcher line instead, prefixed with its package name, plus
the watcher's "changed" and "Triggered reload" lines for each reload.

### Stopping `nicely develop`

Each watcher runs in its own process group, so none of them outlives `nicely develop`:

- Ctrl+C, SIGTERM, a closed terminal (SIGHUP), a crash, or any other exit stops every watcher.
- Each group is led by a small wrapper that stops the group when its pipe to `nicely develop`
  closes, which also covers a `kill -9` of `nicely develop`.
- Every group is recorded in `{workspace}/.nice/develop.pids`. The next `nicely develop` stops
  any group left running by one that is gone, and warns when another `nicely develop` is still
  running. A recorded pid is only signaled while its start time and command still match.
- `nicely develop --stop` stops every recorded watcher and the `nicely develop` that owns it.
- Stopping warns when a package has no build output yet (its package.json `main` is missing:
  stopped before its first build finished), with the packages to rebuild. The next
  `nicely develop` warns about them too and rebuilds them.
- A scoped build (`nicely build icons`, `nicely build <names>`) and `nicely reset` stop a running
  `nicely develop` the same way before building, since both write the same `dist/` (the scoped
  build skips this with `--no-kill`).

### Testing Multiple Linked Packages

```bash
# In your main project, link multiple dependencies
nice-toolkit ../nice-react-button
nice-toolkit ../nice-react-icon
nice-toolkit ../nice-react-flex

# All three packages are now linked and share the same React instance
```

### Custom Exclusion Patterns

```bash
# Only remove React and React DOM (skip styled-components)
nice-toolkit --exclude react,react-dom ../my-component

# Remove default packages plus Material-UI
nice-toolkit --add-exclude @mui/material,@mui/icons-material ../my-component

# Combine with other options
nice-toolkit --manager yarn --add-exclude @emotion/react ../my-component --dry-run
```

### Dry Run for Safety

```bash
# Preview what would happen without making changes
nice-toolkit --dry-run ../nice-react-button

# See what would be cleaned without linking
nice-toolkit --dedupe --dry-run ../nice-react-button
```

### Skip Automatic peerDependencies Management

```bash
# Link without modifying the linked package's package.json
nice-toolkit --skip-peer-check ../nice-react-button
```

## Unlinking

To unlink a package, simply change the `package.json` entry back to a version number:

```bash
# Manual method: Edit package.json
# Change: "my-package": "file:../my-package"
# To:     "my-package": "^1.0.0"

# Then reinstall
npm install
```

Or remove the dependency entirely and reinstall from npm:

```bash
npm uninstall my-package
npm install my-package
```

## Troubleshooting

### "Invalid hook call" Error

**Problem:** You're seeing errors like "Invalid hook call. Hooks can only be called inside the body of a function component."

**Solution:** This means multiple copies of React are running. Ensure you've removed React from the linked package:

```bash
# Re-run the link command to clean up
nice-toolkit ../my-component

# Or use --dedupe to just remove conflicts
nice-toolkit --dedupe ../my-component
```

### Module Not Found After Linking

**Problem:** After linking, your app can't find the linked module.

**Solution:** Make sure the linked package has been built:

```bash
cd ../my-component
npm run build
cd -
nice-toolkit ../my-component
```

### Changes Not Appearing in Development

**Problem:** You modify the linked package but don't see changes in your app.

**Solutions:**

1. **Use a watch/dev script** in the linked package:
   ```bash
   cd ../my-component
   npm run dev  # or build:watch
   ```

2. **For Create React App**, use the `--preserve-symlinks` flag:
   ```bash
   NODE_OPTIONS=--preserve-symlinks npm start
   ```

3. **Restart your dev server** after making changes if you don't have watch mode.

### Styled-Components Context Issues

**Problem:** Errors about multiple instances of styled-components or "Cannot read property 'xxx' of undefined" in styled-components.

**Solution:** Ensure styled-components is removed from the linked package:

```bash
# Default behavior removes styled-components
nice-toolkit ../my-component

# Or explicitly add it
nice-toolkit --add-exclude styled-components ../my-component
```

### TypeScript Declaration Conflicts

**Problem:** TypeScript errors about conflicting React type definitions.

**Solution:** The default configuration already removes `@types/react` and `@types/react-dom`. If you still have issues:

```bash
# Ensure types are removed
nice-toolkit --add-exclude @types/react,@types/react-dom ../my-component

# Check your linked package's package.json
# React types should be in devDependencies or peerDependencies, not dependencies
```

### Package Manager Detection Issues

**Problem:** Wrong package manager is being used.

**Solution:** Force the correct package manager:

```bash
nice-toolkit --manager pnpm ../my-component
nice-toolkit --manager yarn ../my-component
nice-toolkit --manager npm ../my-component
```

### Workspace/Monorepo Conflicts

**Problem:** Getting warnings about workspaces, or linking doesn't work in a monorepo.

**Solution:** In monorepos, consider using native workspace features instead:

```jsonc
// package.json in your app
{
  "dependencies": {
    "my-package": "workspace:*"  // pnpm/yarn workspaces
  }
}
```

Or use the file: protocol directly:

```json
{
  "dependencies": {
    "my-package": "file:../packages/my-package"
  }
}
```

### Permission Errors

**Problem:** Getting EACCES or permission denied errors.

**Solution:**

1. Don't use `sudo` with npm link - it can cause permission issues
2. Fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally
3. Use `--dry-run` to see what would happen first

### Link Successful but Package Not Updated

**Problem:** The link command succeeds but your app still uses the old version.

**Solution:**

1. **Clear your bundler cache:**
   ```bash
   # For Create React App
   rm -rf node_modules/.cache

   # For Next.js
   rm -rf .next

   # For Vite
   rm -rf node_modules/.vite
   ```

2. **Restart your development server**

3. **Verify the link:**
   ```bash
   ls -la node_modules/my-package
   # Should show it pointing to your local directory
   ```

## Requirements

- Node.js (v14 or higher recommended)
- npm, yarn, or pnpm
- The target package must have a valid `package.json`
- You must run this from the project where you want to link the package

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT