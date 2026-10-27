/**
 * @fileoverview Renders the develop tree model to a block of lines (the TTY view).
 *
 * Pure: `toLines(model, now, size)` derives every animated glyph from wall-clock time,
 * so the animation resyncs after an event-loop stall. The block is:
 * - a header: packages, building count, start progress (then "all built once in Xs"),
 *   the reload count and the last reload;
 * - one row per package: ♥ building (`1.2s · ⠦ <newest step>`; verbose: `1.2s · Building`),
 *   ✓ ready (last build's duration and dist/ size, yellow over 8s / 512 KB, red over 20s / 2 MB), ⚠ warnings, ✗ failed or exited, · queued
 *   (the first package it waits for, and how many others);
 *   under --verbose, building packages list their steps and finished ones leave the block;
 * - the pinned diagnostics of every failed package.
 * It is fitted to the terminal height (ready rows collapse to one line, verbose steps condense,
 * then pinned diagnostics are cut), so the live region never scrolls (its cursor math needs that).
 *
 * @module cli/develop/tree-view
 */

const { HEART, BRAND, paint } = require('../../shared/palette');
const { dotFor } = require('../../shared/dot-frames');
const { gray, yellow, red, green, white } = require('../../shared/logger');
const { MAX_SUBITEMS } = require('./tree-model');
const { summarizeStep } = require('./step-summary');

const HEART_MS = 120; // heart color cadence (independent of the 80ms braille tick)

/** The heart, colored by the current instant. */
const heartGlyph = (now) => paint(BRAND[Math.floor(now / HEART_MS) % BRAND.length], HEART);

/** `nice-react-button` → `react-button` */
const shortName = (name) => name.replace(/^nice-/, '');

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const MB = 1024 * 1024;

/** `48.3 KB` (1024-based, as tsup prints sizes) */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

// [yellow, red] limits, from a cold start of all 31 linked packages at once: builds take
// 2.7–5.8s (outliers 14.8s, 58.2s); dist/ holds 9–401 KB (outliers: the icon packages, 4–5 MB)
const TIME_LIMITS = [8_000, 20_000];
const SIZE_LIMITS = [512 * 1024, 2 * MB];

/** `base`, or yellow / red once `value` passes the `[yellow, red]` limits. */
const byCost = (value, [warnAt, badAt], text, base = gray) => (value > badAt ? red : value > warnAt ? yellow : base)(text);

/** A running build's elapsed time: white while it counts, yellow / red as it passes TIME_LIMITS. */
const elapsedText = (ms) => byCost(ms, TIME_LIMITS, seconds(ms), white);

/** A finished build's duration and dist/ size: yellow / red past TIME_LIMITS / SIZE_LIMITS. */
function buildCost(entry) {
  const duration = byCost(entry.duration, TIME_LIMITS, seconds(entry.duration));
  if (entry.outputBytes === null) return duration;
  return `${duration}${gray(' · ')}${byCost(entry.outputBytes, SIZE_LIMITS, formatSize(entry.outputBytes))}`;
}

/** "Waiting for react-styles", "Waiting for react-styles, and 1 other", "…, and 3 others" */
function waitingText([first, ...rest]) {
  const others = rest.length === 0 ? '' : `, and ${rest.length} other${rest.length === 1 ? '' : 's'}`;
  return `Waiting for ${shortName(first)}${others}`;
}

/** "4s ago", "3m ago" */
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** The header: the run's state, then the reloads (a second line, once there is one). */
function headerLines(model, now) {
  const entries = model.all();
  const building = entries.filter((entry) => entry.state === 'building').length;
  const started = entries.filter((entry) => entry.state !== 'queued').length;
  const allBuiltIn = model.allBuiltIn();
  const reloads = model.reloads();
  const parts = [
    `${entries.length} packages`,
    `${building} building`,
    allBuiltIn === null ? `${started}/${entries.length} started` : `all built once in ${seconds(allBuiltIn)}`,
  ];
  const glyph = building > 0 ? heartGlyph(now) : paint(BRAND[0], HEART);
  const lines = [`${glyph} nicely develop  ${gray(parts.join(' · '))}`];
  if (reloads.count > 0) {
    const count = `${reloads.count} reload${reloads.count === 1 ? '' : 's'}`;
    lines.push(gray(`  ${count} · last ${ago(now - reloads.at)} (${shortName(reloads.pkg)})`));
  }
  return lines;
}

/**
 * One package row (indented two spaces). A building package shows the time since its build
 * cycle started (the finished row's duration counts from the same instant), then, condensed, its
 * spinner and newest step; expanded (its steps listed under it), Building or Rebuilding. The
 * time is white while it counts, yellow over 8s and red over 20s.
 */
function rowLine(entry, model, now, width, { expanded = false } = {}) {
  const name = shortName(entry.name).padEnd(width);
  switch (entry.state) {
    case 'queued': {
      const waiting = [...entry.deps].filter((dep) => {
        const state = model.get(dep)?.state;
        return state === 'queued' || state === 'building';
      });
      return `  ${gray('·')} ${gray(name)}  ${gray(waiting.length ? waitingText(waiting) : 'Queued')}`;
    }
    case 'building': {
      const newest = entry.subItems[entry.subItems.length - 1];
      const elapsed = `${elapsedText(now - entry.startedAt)}${gray(' · ')}`;
      if (expanded || !newest) {
        return `  ${heartGlyph(now)} ${name}  ${elapsed}${gray(entry.builtOnce ? 'Rebuilding' : 'Building')}`;
      }
      return `  ${heartGlyph(now)} ${name}  ${elapsed}${gray(`${dotFor(now)} ${stepText(newest)}`)}`;
    }
    default: {
      const { outcome } = entry;
      if (outcome.kind === 'failed') return `  ${red('✗')} ${name}  ${red(outcome.detail)}`;
      if (outcome.kind === 'warned') {
        return `  ${yellow('⚠')} ${name}  ${gray(`${outcome.count} warning${outcome.count === 1 ? '' : 's'} · `)}${buildCost(entry)}`;
      }
      return `  ${green('✓')} ${name}  ${buildCost(entry)}`;
    }
  }
}

/** A step as shown: summarized, unless it is an error or warning (diagnostics keep their words). */
const stepText = (item) => (item.state === 'failed' || item.state === 'warning' ? item.text : summarizeStep(item.text));

/** A package's steps, indented under its row. */
function stepLines(items, now) {
  const lines = [];
  for (const item of items) {
    let glyph;
    switch (item.state) {
      case 'active': glyph = gray(dotFor(now)); break;
      case 'warning': glyph = yellow('⚠'); break;
      case 'failed': glyph = red('✗'); break;
      default: glyph = gray('✓');
    }
    lines.push(`      ${glyph} ${gray(stepText(item))}`);
    if (item.detail) lines.push(`        ${gray(item.detail)}`);
  }
  return lines;
}

/** The pinned diagnostics of one failed package, cut to `budget` lines. */
function pinnedLines(entry, budget) {
  const lines = [`${red('✗')} ${entry.name}`, ...entry.pinned.map((line) => `  ${line}`)];
  if (lines.length <= budget) return lines;
  const kept = lines.slice(0, Math.max(1, budget - 1));
  kept.push(gray(`  … ${lines.length - kept.length} more lines (nicely develop --raw prints everything)`));
  return kept;
}

/** The width package names are padded to, so rows line up across the tree and the scrollback. */
const nameWidth = (model) => Math.max(0, ...model.all().map((entry) => shortName(entry.name).length));

/** --verbose: a finished package's row and every step of its build, printed once to the scrollback. */
function finishedLines(model, entry, now) {
  return [rowLine(entry, model, now, nameWidth(model)), ...stepLines(entry.subItems, now)];
}

/**
 * Builds the full line block for the current model state.
 *
 * - Condensed (default): one row per package; a building package's newest step is on its row.
 * - Verbose: finished packages are not in the block (develop-view prints them to the scrollback
 *   with their steps); building packages list their steps under their row, all but the one that
 *   printed last condensed when the block would not fit.
 *
 * @param {ReturnType<import('./tree-model').createTreeModel>} model
 * @param {number} now - Wall-clock ms
 * @param {{ rows?: number, verbose?: boolean }} [options] - The block is fitted to `rows - 1` lines
 * @returns {string[]}
 */
function toLines(model, now, { rows = Infinity, verbose = false } = {}) {
  const budget = rows - 1;
  const entries = model.all();
  const width = nameWidth(model);
  const isReady = (entry) => entry.state === 'settled' && entry.outcome.kind !== 'failed';
  const building = entries.filter((entry) => entry.state === 'building');
  const focus = building.reduce((last, entry) => (!last || entry.outputAt > last.outputAt ? entry : last), null);

  const packageLines = ({ collapseReady, expandAll }) => {
    const lines = [];
    const ready = entries.filter(isReady);
    // Under --verbose, finished packages are in the scrollback already
    if (collapseReady && !verbose && ready.length > 0) lines.push(`  ${green('✓')} ${gray(`${ready.length} ready`)}`);
    for (const entry of entries) {
      if ((verbose || collapseReady) && isReady(entry)) continue;
      const expanded = verbose && entry.state === 'building' && (expandAll || entry === focus);
      lines.push(rowLine(entry, model, now, width, { expanded }));
      if (expanded) lines.push(...stepLines(entry.subItems.slice(expandAll ? 0 : -MAX_SUBITEMS), now));
    }
    return lines;
  };

  const header = headerLines(model, now);
  const failed = entries.filter((entry) => entry.pinned && (entry.state === 'exited' || entry.outcome?.kind === 'failed'));
  const pinnedTotal = failed.reduce((sum, entry) => sum + entry.pinned.length + 2, 0);
  const fits = (block) => header.length + block.length + pinnedTotal <= budget;
  let rowsBlock = packageLines({ collapseReady: false, expandAll: true });
  if (!fits(rowsBlock)) rowsBlock = packageLines({ collapseReady: true, expandAll: false });

  const lines = [...header, ...rowsBlock];
  let left = budget - lines.length;
  for (const entry of failed) {
    if (left < 3) break;
    lines.push('');
    const block = pinnedLines(entry, left - 1);
    lines.push(...block);
    left -= block.length + 1;
  }
  return lines.slice(0, Math.max(1, budget));
}

module.exports = { toLines, finishedLines, shortName, seconds };
