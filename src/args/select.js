/**
 * @fileoverview Target selection for list verbs (`publish`, `build`, `dedupe`).
 *
 * One rule for every verb that operates on a set of registry packages, so
 * "which packages" is answered the same way everywhere:
 *
 *   nicely <verb>                 → the verb's default scope (empty selection)
 *   nicely <verb> all             → every registered package
 *   nicely <verb> icons           → a named group (root(s) the graph expands)
 *   nicely <verb> nice-icons …    → those packages (space-separated names)
 *   nicely <verb> --changed       → the affected set (handled by the verb)
 *
 * Groups are *derived roots*, not a hard-coded package list: `icons` resolves to
 * `["nice-icons"]`, and each verb expands dependents through the same reverse
 * `file:`-dependency graph it already uses (publish cascade / buildAffected).
 * Adding a group here is a one-line change; the ordering stays graph-driven.
 *
 * @module args/select
 */

/**
 * Named target groups → the root package(s) the verb expands via the graph.
 * Keep these to *roots*; never enumerate dependents by hand (that's the graph's
 * job — see `resolveAffected`).
 */
const GROUPS = {
  icons: ['nice-icons'],
};

/** The literal keyword that selects every registered package. */
const ALL = 'all';

/**
 * Resolve raw target tokens into a normalized selection.
 *
 * @param {string[]} tokens - Positional target tokens after the verb
 * @returns {{ empty: boolean, all: boolean, roots: string[] }}
 *   - `empty`  — no targets given (verb applies its default scope)
 *   - `all`    — the `all` keyword was used
 *   - `roots`  — explicit package/group root names (groups already expanded to roots)
 */
function resolveTargets(tokens) {
  if (!tokens || tokens.length === 0) return { empty: true, all: false, roots: [] };
  if (tokens.length === 1 && tokens[0] === ALL) return { empty: false, all: true, roots: [] };

  const roots = [];
  for (const token of tokens) {
    if (token === ALL) {
      // `all` mixed with names is ambiguous — treat as all, but flag it.
      return { empty: false, all: true, roots: [] };
    }
    if (GROUPS[token]) roots.push(...GROUPS[token]);
    else roots.push(token);
  }
  return { empty: false, all: false, roots: [...new Set(roots)] };
}

module.exports = { resolveTargets, GROUPS, ALL };
