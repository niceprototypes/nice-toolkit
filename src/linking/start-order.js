/**
 * @fileoverview Start order for `nicely develop`: each package's watcher starts only after
 * the nice-* packages it depends on have finished their first build.
 *
 * A dependent whose build reads a dependency's types while that dependency's first build is still
 * writing them (tsup's DTS step for the storybook packages) fails with TS2307 and never retries.
 * nice-config-rollup no longer empties dist/ on start, which closed the widest window; tsup's
 * `clean` still empties its output, so ordering starts by dependency stays as the safeguard.
 *
 * The order comes from each package's own package.json (dependencies, devDependencies and
 * peerDependencies naming `nice-*`), limited to the packages being run: that is what a build
 * actually imports. Packages with no unsettled dependency start together.
 *
 * Pure apart from the injected `start` and timers, so the scheduler is unit-testable.
 *
 * @module linking/start-order
 */

const fs = require('fs');
const path = require('path');

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

/**
 * The nice-* package names a package.json declares, in any dependency field.
 *
 * @param {object} pkgJson
 * @returns {Set<string>}
 */
function niceDependencies(pkgJson) {
  const names = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkgJson[field] ?? {})) {
      if (name.startsWith('nice-')) names.add(name);
    }
  }
  return names;
}

/**
 * Each package's dependencies among the packages being run.
 *
 * @param {Array<{ name: string, path: string }>} packages
 * @returns {Map<string, Set<string>>}
 */
function buildStartGraph(packages) {
  const running = new Set(packages.map((pkg) => pkg.name));
  const graph = new Map();
  for (const pkg of packages) {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkg.path, 'package.json'), 'utf-8'));
    const deps = [...niceDependencies(pkgJson)].filter((name) => running.has(name) && name !== pkg.name);
    graph.set(pkg.name, new Set(deps));
  }
  return graph;
}

/**
 * The members of the dependency cycles among `waiting` that depend on no other waiting package:
 * the strongly connected components (Tarjan) with no edge out to another component. When
 * nothing can start, at least one such cycle exists.
 *
 * @param {Map<string, Set<string>>} graph
 * @param {Set<string>} waiting
 * @returns {string[]}
 */
function startableCycles(graph, waiting) {
  const deps = (name) => [...graph.get(name)].filter((dep) => waiting.has(dep));
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const visit = (name) => {
    index.set(name, index.size);
    low.set(name, index.get(name));
    stack.push(name);
    onStack.add(name);
    for (const dep of deps(name)) {
      if (!index.has(dep)) {
        visit(dep);
        low.set(name, Math.min(low.get(name), low.get(dep)));
      } else if (onStack.has(dep)) {
        low.set(name, Math.min(low.get(name), index.get(dep)));
      }
    }
    if (low.get(name) === index.get(name)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== name);
      components.push(component);
    }
  };
  for (const name of waiting) if (!index.has(name)) visit(name);

  return components
    .filter((component) => component.every((name) => deps(name).every((dep) => component.includes(dep))))
    .flat();
}

/**
 * @typedef {import('../cli/develop/cycle-tracker').CycleOutcome | 'timeout'} StartOutcome
 */

/**
 * The order the packages start in, dependencies first: what `scheduleStarts` does when every
 * first build takes the same time. The develop view lists the packages in it.
 *
 * @param {Map<string, Set<string>>} graph
 * @returns {string[]}
 */
function startOrder(graph) {
  const order = [];
  const waiting = new Set(graph.keys());
  while (waiting.size > 0) {
    let ready = [...waiting].filter((name) => [...graph.get(name)].every((dep) => !waiting.has(dep)));
    if (ready.length === 0) ready = startableCycles(graph, waiting);
    for (const name of ready) waiting.delete(name);
    order.push(...ready);
  }
  return order;
}

/**
 * Starts every package in dependency order. A package starts once all of its dependencies have
 * settled (ready, failed, exited or timed out); packages that become startable together start
 * together. Never deadlocks: a dependency cycle starts its remaining members anyway, and each
 * package's first cycle is capped by `timeoutMs`.
 *
 * @param {Map<string, Set<string>>} graph - From `buildStartGraph`
 * @param {(name: string) => Promise<import('../cli/develop/cycle-tracker').CycleOutcome>} start
 *   Starts one watcher; resolves when its first build cycle settles
 * @param {object} [options]
 * @param {number} [options.timeoutMs=180000]
 * @param {(names: string[], waitedFor: string[]) => void} [options.onStart] - A batch is starting
 * @param {(name: string, outcome: StartOutcome) => void} [options.onSettled]
 * @param {(names: string[]) => void} [options.onCycle] - A dependency cycle is being broken
 * @param {() => boolean} [options.isStopped] - Stop starting new packages once true
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 * @returns {Promise<Map<string, StartOutcome>>} Every package's first-cycle outcome
 */
function scheduleStarts(graph, start, options = {}) {
  const {
    timeoutMs = 180000,
    onStart = () => {},
    onSettled = () => {},
    onCycle = () => {},
    isStopped = () => false,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;

  const waiting = new Set(graph.keys());
  const outcomes = new Map();
  let running = 0;

  return new Promise((resolve) => {
    const settle = (name, outcome) => {
      if (outcomes.has(name)) return;
      outcomes.set(name, outcome);
      running--;
      onSettled(name, outcome);
      launch();
    };

    const startOne = (name) => {
      running++;
      const timer = setTimer(() => settle(name, 'timeout'), timeoutMs);
      Promise.resolve(start(name)).then(
        (outcome) => {
          clearTimer(timer);
          settle(name, outcome);
        },
        () => {
          clearTimer(timer);
          settle(name, 'exited');
        }
      );
    };

    const launch = () => {
      if (isStopped()) {
        waiting.clear();
      }
      let ready = [...waiting].filter((name) => [...graph.get(name)].every((dep) => outcomes.has(dep)));
      // Nothing startable, nothing running, but packages left: start the dependency cycles that
      // wait on nothing outside themselves; their dependents still wait for them
      if (ready.length === 0 && running === 0 && waiting.size > 0) {
        ready = startableCycles(graph, waiting);
        onCycle(ready);
      }
      if (ready.length > 0) {
        for (const name of ready) waiting.delete(name);
        const waitedFor = [...new Set(ready.flatMap((name) => [...graph.get(name)]))];
        onStart(ready, waitedFor);
        for (const name of ready) startOne(name);
      }
      if (waiting.size === 0 && running === 0) resolve(outcomes);
    };

    launch();
  });
}

module.exports = { niceDependencies, buildStartGraph, scheduleStarts, startOrder };
