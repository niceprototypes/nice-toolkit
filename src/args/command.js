/**
 * @fileoverview Subcommand parsing for the `nicely <verb> [targets] [--flags]`
 * grammar.
 *
 * Splits argv into a verb (argv[0]), its positional targets, and its modifier
 * flags. Verbs are the actions; flags are options on the action. This replaces
 * the old flat `--flag`-per-mode surface — see the migration map below.
 *
 * @module args/command
 */

const { getArg, getMultiArg, hasFlag, parseList } = require('./parsers');

/** The verbs the router dispatches. */
const VERBS = ['link', 'unlink', 'publish', 'build', 'dedupe', 'clean', 'reset', 'develop', 'bump'];

/**
 * Old flag-command → new invocation, for the one-release migration shim. When a
 * user runs the old syntax we print the modern equivalent instead of guessing.
 */
const LEGACY = {
  '--publish': 'publish',
  '--dry-publish': 'publish --dry-run',
  '--unlink': 'unlink',
  '--dedupe': 'dedupe',
  '--clean': 'clean',
  '--vite': 'clean --vite',
  '--build-all': 'build all',
  '--build-icons': 'build icons',
  '--reset': 'reset',
  '--dev': 'develop',
  '--watch': 'develop --reload-only',
  '--bump': 'bump',
};

/** Flags that consume the following token as their value (for positional split). */
const FLAGS_WITH_VALUES = new Set(['--exclude', '--add-exclude', '--manager', '--dir', '--watch-dir']);

/**
 * Flags that consume every token after them up to the next flag — a list value.
 * `--convert carat-top carat-bottom carat-left` converts several icons in one
 * build; the whole run is kept out of the positional targets.
 */
const MULTI_VALUE_FLAGS = new Set(['--convert']);

/**
 * Levenshtein distance — for "did you mean?" suggestions on an unknown verb.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Nearest known verb within edit distance 2, or null. */
function nearestVerb(token) {
  let best = null;
  let bestD = 3;
  for (const v of VERBS) {
    const dd = distance(token, v);
    if (dd < bestD) { bestD = dd; best = v; }
  }
  return best;
}

/**
 * Classify argv into a command.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ verb: string, rest?: string[], token?: string, suggestion?: string|null }}
 *   - `verb: 'help'`      — show usage
 *   - `verb: '__legacy__'`— old `--flag` syntax; `suggestion` = modern form
 *   - `verb: '__unknown__'`— unknown token; `suggestion` = nearest verb or null
 *   - otherwise a known verb with `rest` = the post-verb argv
 */
function parseCommand(argv) {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help') || argv[0] === 'help') {
    return { verb: 'help' };
  }
  const head = argv[0];
  if (head.startsWith('-')) {
    return { verb: '__legacy__', token: head, suggestion: LEGACY[head] || null };
  }
  if (!VERBS.includes(head)) {
    return { verb: '__unknown__', token: head, suggestion: nearestVerb(head) };
  }
  return { verb: head, rest: argv.slice(1) };
}

/**
 * Parse the modifier flags shared across verbs from the post-verb argv. No verb
 * dispatch, no help logic, no positional-as-target (targets are read separately
 * via `findPositionalArgs`) — just the option bag each handler expects.
 *
 * @param {string[]} args - argv after the verb
 * @param {{ conflictingPackages: string[], pm: string }} defaults
 * @returns {object} modifier options
 */
function parseModifiers(args, { conflictingPackages, pm: defaultPM }) {
  let packagesToRemove = [...conflictingPackages];
  const exclude = getArg(args, '--exclude');
  if (exclude) packagesToRemove = parseList(exclude);
  const addExclude = getArg(args, '--add-exclude');
  if (addExclude) packagesToRemove = [...new Set([...packagesToRemove, ...parseList(addExclude)])];

  const forcedPM = getArg(args, '--manager');
  // `--convert` takes a list: the icon names to regenerate before building
  // (`--convert carat-top carat-bottom`). Bare `--convert` → [] → convert all.
  const convertTargets = getMultiArg(args, '--convert');
  const watchDir = getArg(args, '--dir') || getArg(args, '--watch-dir');

  return {
    dryRun: hasFlag(args, '--dry-run'),
    changed: hasFlag(args, '--changed'),
    noNpm: hasFlag(args, '--no-npm'),
    noKill: hasFlag(args, '--no-kill'),
    skipPeerCheck: hasFlag(args, '--skip-peer-check'),
    vite: hasFlag(args, '--vite'),
    convert: hasFlag(args, '--convert'),
    convertTargets,
    log: hasFlag(args, '--log'),
    reloadOnly: hasFlag(args, '--reload-only'),
    noReload: hasFlag(args, '--no-reload'),
    watchDir: watchDir || 'dist',
    packagesToRemove,
    pm: forcedPM || defaultPM,
    forcedPM: Boolean(forcedPM),
  };
}

module.exports = { parseCommand, parseModifiers, VERBS, LEGACY, FLAGS_WITH_VALUES, MULTI_VALUE_FLAGS };
