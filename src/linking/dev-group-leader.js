/**
 * @fileoverview Process-group leader for one `nicely develop` watcher.
 *
 * dev-runner spawns this script (detached, so it leads a new process group) in a package
 * directory; it runs `npm run dev` inside that group. It stops the whole group when:
 * - its stdin closes: dev-runner holds the other end of that pipe, and the OS closes it when
 *   dev-runner's process ends for any reason, SIGKILL included, so the watchers die with it;
 * - it receives SIGTERM, SIGINT or SIGHUP (dev-runner's own stop);
 * - `npm run dev` exits (stragglers such as a rollup grandchild go with it).
 *
 * Stopping sends SIGTERM to the group, then SIGKILL to whatever is left after the grace window.
 * The leader exits with npm's exit code, so dev-runner still sees how the watcher ended.
 *
 * @module linking/dev-group-leader
 */

const { spawn } = require('child_process');

const GRACE_MS = 3000;

let stopping = false;

const signalGroup = (signal) => {
  try {
    process.kill(-process.pid, signal);
  } catch {
    /* group already empty */
  }
};

/** SIGTERM the group (this process ignores it), SIGKILL any survivor after the grace window. */
function stopGroup() {
  if (stopping) return;
  stopping = true;
  signalGroup('SIGTERM');
  setTimeout(() => signalGroup('SIGKILL'), GRACE_MS);
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, stopGroup);

const npm = spawn('npm', ['run', 'dev'], { stdio: ['ignore', 'inherit', 'inherit'] });

npm.on('exit', (code, signal) => {
  // Watcher stopped on request: the grace timer ends the group, this process included
  if (stopping) return;
  // Watcher crashed or finished: take its stragglers down, report its exit code
  stopGroup();
  process.exit(code ?? (signal ? 1 : 0));
});

process.stdin.on('end', stopGroup);
process.stdin.on('close', stopGroup);
process.stdin.resume();
