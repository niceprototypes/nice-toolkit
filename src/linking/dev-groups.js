/**
 * @fileoverview The record of `nicely develop`'s watcher process groups (`{workspace}/.nice/develop.pids`).
 *
 * Each watcher runs in its own detached process group, so a `nicely develop` that dies without
 * running its shutdown (SIGKILL, a crash before the handlers run) would leave the groups running
 * under launchd. Every group is recorded here with its owner; the next `nicely develop` stops the
 * groups whose owner is gone, and `nicely develop --stop` stops them all.
 *
 * A recorded pid is only signaled when the live process still has the recorded start time and
 * command line, so a pid the OS has since reused for something else is never touched.
 *
 * @module linking/dev-groups
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { info, warn } = require('../shared/logger');

/** How long a group gets to exit on SIGTERM before it is SIGKILLed. */
const GRACE_MS = 1000;

/**
 * Synchronous sleep without a busy-loop: the grace window between SIGTERM and SIGKILL.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @typedef {object} ProcessIdentity
 * @property {number} pid
 * @property {string} started - `ps` lstart: fixed for the life of the process
 * @property {string} command - Full command line
 */

/**
 * @typedef {object} GroupEntry
 * @property {number} pgid - The group leader's pid
 * @property {string} started
 * @property {string} command
 * @property {string} cwd - The package the group builds
 * @property {ProcessIdentity} owner - The `nicely develop` that started it
 */

/**
 * The start time and command line of a live process, or null when there is none.
 *
 * @param {number} pid
 * @returns {ProcessIdentity | null}
 */
function probeProcess(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    // lstart is a fixed-width 24-character date ("Thu Oct  8 10:24:12 2026")
    return out ? { pid, started: out.slice(0, 24), command: out.slice(24).trim() } : null;
  } catch {
    return null;
  }
}

/** True when `identity`'s process is still running and is the same process. */
function isSameProcess(identity, probe) {
  const live = probe(identity.pid);
  return Boolean(live) && live.started === identity.started && live.command === identity.command;
}

/** True when the entry's group leader is still running and is the same process. */
function isGroupAlive(entry, probe) {
  return isSameProcess({ pid: entry.pgid, started: entry.started, command: entry.command }, probe);
}

/** @returns {GroupEntry[]} */
function readEntries(file) {
  try {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function writeEntries(file, entries) {
  if (entries.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

/**
 * Records a group just spawned by `owner`.
 *
 * @param {string} file
 * @param {{ pgid: number, cwd: string, owner: ProcessIdentity }} group
 * @param {{ probe?: typeof probeProcess }} [options]
 */
function recordGroup(file, { pgid, cwd, owner }, { probe = probeProcess } = {}) {
  const leader = probe(pgid);
  // Exited already: nothing left to stop later
  if (!leader) return;
  writeEntries(file, [...readEntries(file), { pgid, started: leader.started, command: leader.command, cwd, owner }]);
}

/** Removes `owner`'s entries (its groups have been stopped). */
function forgetOwner(file, owner) {
  const kept = readEntries(file).filter((entry) => entry.owner.pid !== owner.pid || entry.owner.started !== owner.started);
  writeEntries(file, kept);
}

/**
 * SIGTERMs each group, waits out the grace window, then SIGKILLs the groups still running.
 *
 * @param {GroupEntry[]} entries - Verified live groups
 * @param {{ probe?: typeof probeProcess, kill?: typeof process.kill, wait?: (ms: number) => void }} [options]
 */
function killGroups(entries, { probe = probeProcess, kill = process.kill, wait = sleepSync } = {}) {
  const signal = (entry, name) => {
    try {
      kill(-entry.pgid, name);
    } catch {
      /* gone */
    }
  };
  entries.forEach((entry) => signal(entry, 'SIGTERM'));
  if (entries.length === 0) return;
  wait(GRACE_MS);
  entries.filter((entry) => isGroupAlive(entry, probe)).forEach((entry) => signal(entry, 'SIGKILL'));
}

/**
 * Startup cleanup: stops the groups a dead `nicely develop` left running, drops entries whose
 * group has exited, and keeps the entries of another `nicely develop` that is still running.
 *
 * @param {string} file
 * @param {{ probe?: typeof probeProcess, kill?: typeof process.kill, wait?: (ms: number) => void }} [options]
 * @returns {{ orphaned: GroupEntry[], liveOwners: ProcessIdentity[], ended: GroupEntry[] }} `ended`:
 *   every entry of an earlier develop no longer running (stopped here, or already gone)
 */
function cleanOrphanedGroups(file, options = {}) {
  const { probe = probeProcess } = options;
  const entries = readEntries(file);
  const alive = entries.filter((entry) => isGroupAlive(entry, probe));
  const ownerAlive = new Map();
  const isOwnerAlive = (owner) => {
    const key = `${owner.pid} ${owner.started}`;
    if (!ownerAlive.has(key)) ownerAlive.set(key, isSameProcess(owner, probe));
    return ownerAlive.get(key);
  };
  const orphaned = alive.filter((entry) => !isOwnerAlive(entry.owner));
  const kept = alive.filter((entry) => isOwnerAlive(entry.owner));
  killGroups(orphaned, options);
  const ended = entries.filter((entry) => !kept.includes(entry));
  writeEntries(file, kept);
  const liveOwners = [...new Map(kept.map((entry) => [`${entry.owner.pid} ${entry.owner.started}`, entry.owner])).values()];
  return { orphaned, liveOwners, ended };
}

/**
 * The packages among `dirs` whose package.json `main` file is missing: a watcher stopped before
 * its first build wrote it (tsup's `clean` and the icons generator empty their output first).
 *
 * @param {string[]} dirs
 * @returns {string[]} Package names
 */
function packagesWithoutBuild(dirs) {
  const names = [];
  for (const dir of dirs) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkgJson.main && !fs.existsSync(path.join(dir, pkgJson.main))) names.push(pkgJson.name);
    } catch {
      /* not a package any more */
    }
  }
  return names;
}

/**
 * Warns about the packages among `dirs` left without their build (see `packagesWithoutBuild`).
 *
 * @param {string[]} dirs
 * @param {string} [hint] - What to do about it
 * @returns {string[]} The package names warned about
 */
function warnMissingBuilds(dirs, hint) {
  const names = packagesWithoutBuild(dirs);
  if (names.length === 0) return names;
  const short = names.map((name) => name.replace(/^nice-/, '')).join(', ');
  const fallback = `run nicely develop again, or nicely build ${names.join(' ')}`;
  warn(`${names.length} package${names.length === 1 ? ' has' : 's have'} no build output (stopped before its first build finished): ${short}. ${hint ?? fallback}`);
  return names;
}

/**
 * The recorded groups still running, and the other live `nicely develop` processes that own them.
 *
 * @param {string} file
 * @param {{ probe?: typeof probeProcess }} [options]
 * @returns {{ groups: GroupEntry[], owners: ProcessIdentity[] }}
 */
function findRecordedGroups(file, { probe = probeProcess } = {}) {
  const groups = readEntries(file).filter((entry) => isGroupAlive(entry, probe));
  const owners = [...new Map(groups.map((entry) => [`${entry.owner.pid} ${entry.owner.started}`, entry.owner])).values()]
    .filter((owner) => owner.pid !== process.pid && isSameProcess(owner, probe));
  return { groups, owners };
}

/**
 * Stops every recorded group and SIGTERMs the `nicely develop` processes that own them, then
 * clears the record.
 *
 * @param {string} file
 * @param {{ probe?: typeof probeProcess, kill?: typeof process.kill, wait?: (ms: number) => void }} [options]
 * @returns {{ stopped: GroupEntry[], owners: ProcessIdentity[] }}
 */
function stopRecordedGroups(file, options = {}) {
  const { kill = process.kill } = options;
  const { groups, owners } = findRecordedGroups(file, options);
  for (const owner of owners) {
    try {
      kill(owner.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
  killGroups(groups, options);
  writeEntries(file, []);
  return { stopped: groups, owners };
}

/**
 * Stops a running `nicely develop` and its watchers, logging what it stopped: `nicely develop
 * --stop`, and the build and reset commands that would race its watchers on the same dist/.
 * Under `dryRun` it only reports what it would stop.
 *
 * @param {string} file
 * @param {{ dryRun?: boolean, probe?: typeof probeProcess, kill?: typeof process.kill, wait?: (ms: number) => void }} [options]
 * @returns {number} The watcher groups stopped (or that would be)
 */
function stopDevelop(file, options = {}) {
  const describe = ({ groups, owners }) => {
    const watchers = `${groups.length} watcher${groups.length === 1 ? '' : 's'}`;
    return owners.length ? `${watchers} and nicely develop (pid ${owners.map((owner) => owner.pid).join(', ')})` : watchers;
  };
  if (options.dryRun) {
    const found = findRecordedGroups(file, options);
    if (found.groups.length > 0) info(`Would stop ${describe(found)}`);
    return found.groups.length;
  }
  const { stopped, owners } = stopRecordedGroups(file, options);
  if (stopped.length > 0) info(`Stopped ${describe({ groups: stopped, owners })}`);
  warnMissingBuilds(stopped.map((entry) => entry.cwd));
  return stopped.length;
}

module.exports = {
  probeProcess,
  recordGroup,
  forgetOwner,
  cleanOrphanedGroups,
  findRecordedGroups,
  stopDevelop,
  warnMissingBuilds,
};
