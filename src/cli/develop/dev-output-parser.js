/**
 * @fileoverview Turns a single package's dev-script output into tree events.
 *
 * `createParser(pkg)` returns `feed(line) → Event[]`. One instance PER child —
 * that is what makes interleaving a non-issue: each child's stream is parsed in
 * isolation, never a merged one. The matcher table is ordered, first-match-wins,
 * and best-effort: build/settle/warning/error/cycle-end are recognized per tool
 * (rollup, tsup, tsc, the icons generator); pure noise (npm echoes, version
 * banners) is dropped; anything else passes through as a plain sub-item so real
 * signal is never silently lost.
 *
 * Warnings are multi-line (a `(!)` header + an indented code frame). Grouping is
 * a small sub-FSM: the header opens a `pending` warning, continuation lines feed
 * its detail, and the first non-continuation line (or a cycle-end) flushes it as
 * one event.
 *
 * @module cli/develop/dev-output-parser
 */

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const strip = (s) => s.replace(ANSI, '');

// Lines with no signal for the tree — dropped outright.
const NOISE = [
  /^\s*$/, //                         blank
  /^>\s/, //                          npm script echo:  > pkg@1 dev
  /^rollup v\d/, //                   rollup banner
  /^CLI (Building|Using|tsup|Running|Target)/, // tsup banners
  /Watching for changes in /, //      tsup idle banner (cycle-end handled below)
];

// A rebuild began.
const BUILD_START = [
  /→ dist\//, //                      rollup: bundles src → dist…
  /\bBuild start\b/, //               tsup: CJS/ESM/DTS Build start
  /Starting compilation/, //          tsc --watch
  /File change detected/, //          tsc --watch
];

// A discrete step finished OK.
const SETTLE = [
  /^created (dist\/.*) in /, //       rollup
  /Build success in /, //             tsup
  /^✓ Generated /, //                 nice-icons generator
  /Found 0 errors/, //                tsc clean
];

// Build cycle complete — the tool is idle again.
const CYCLE_END = [
  /waiting for changes/i, //          rollup
  /Watching for file changes/i, //    tsc
];

/** True if `line` looks like part of a rollup/tsc code-frame under a warning. */
function isContinuation(line) {
  return (
    /^\s/.test(line) || //            indented
    /^\/.*:\d+:\d+/.test(line) || //  absolute path with :line:col
    /^\d+\s/.test(line) || //         code-frame line number
    /^\s*[~^]+\s*$/.test(line) //     the ~~~ / ^^^ underline
  );
}

/** First path:line:col found in a warning's continuation lines (the detail line). */
function looksLikePath(line) {
  return /^\/.*:\d+:\d+/.test(line.trim());
}

/**
 * @typedef {object} ParseEvent
 * @property {'build-start'|'sub'|'warning'|'error'|'cycle-end'|'passthrough'} type
 * @property {string} text
 * @property {string} [detail]
 * @property {'active'|'done'} [state]
 */

/**
 * @param {string} pkg - Package name (for context; the parser is stateful per pkg).
 * @returns {{ feed: (raw: string) => ParseEvent[] }}
 */
function createParser(pkg) {
  /** @type {{ text: string, detail?: string } | null} */
  let pending = null;

  const flush = (out) => {
    if (pending) {
      out.push({ type: 'warning', text: pending.text, detail: pending.detail });
      pending = null;
    }
  };

  function feed(raw) {
    const line = strip(raw).replace(/\s+$/, '');
    /** @type {ParseEvent[]} */
    const out = [];

    // ── Warning grouping ──────────────────────────────────────────────
    // While a warning is open, swallow its code frame — indented lines, the
    // path/loc line, the `~~~` underline, AND the blank lines between them (a
    // blank must not split one diagnostic into two). Only a genuine
    // non-continuation line closes it; `line` is then reprocessed below.
    if (pending) {
      if (line === '' || isContinuation(line)) {
        if (!pending.detail && looksLikePath(line)) pending.detail = line.trim();
        return out;
      }
      flush(out);
    }

    if (NOISE.some((re) => re.test(line))) return out;

    // Rollup plugin warning header: "(!) [plugin …] path (l:c): … TSxxxx: …"
    if (/^\(!\)/.test(line)) {
      pending = { text: line.replace(/^\(!\)\s*/, '') };
      return out;
    }

    // tsc "Found N errors" with N > 0 → an error sub-item (fails the cycle).
    // tsc prints this on the same line as its idle banner ("Found 1 errors.
    // Watching for file changes."), so also end the cycle when it does.
    const errMatch = line.match(/Found ([1-9]\d*) errors?/);
    if (errMatch) {
      out.push({ type: 'error', text: line });
      if (CYCLE_END.some((re) => re.test(line))) out.push({ type: 'cycle-end', text: line });
      return out;
    }

    if (CYCLE_END.some((re) => re.test(line))) {
      flush(out);
      out.push({ type: 'cycle-end', text: line });
      return out;
    }

    if (SETTLE.some((re) => re.test(line))) {
      out.push({ type: 'sub', text: line, state: 'done' });
      return out;
    }

    if (BUILD_START.some((re) => re.test(line))) {
      out.push({ type: 'build-start', text: line });
      return out;
    }

    // Unrecognized but non-noise — surface it rather than drop it.
    out.push({ type: 'passthrough', text: line });
    return out;
  }

  return { feed };
}

module.exports = { createParser, strip };
