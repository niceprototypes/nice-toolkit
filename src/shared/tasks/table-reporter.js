/**
 * @fileoverview A table backend for the task reporter surface (see reporter.js).
 *
 * Where the default line reporter prints each task as it settles, the table
 * reporter collects every settled `(label, outcome)` and renders one aligned
 * table on `finalize()` — after the whole list has run. Per-task progress is
 * still shown: each async task animates its own transient heart-spinner (the
 * `activeLabel`, e.g. "Scanning nice-icons"), which clears without printing a
 * line, so the terminal shows the current item then collapses to the table.
 *
 * The caller supplies the shape: `headers` (column titles) and `toRow(label,
 * outcome)` → an array of cell strings (already colored). Column widths are
 * computed from the visible (ANSI-stripped) cell lengths, so colored cells align.
 *
 * @module shared/tasks/table-reporter
 */

const { startHeartSpinner } = require('../heart-spinner');
const { gray } = require('../logger');

// Strip SGR color codes so padding measures visible width, not byte length.
const ANSI = /\x1b\[[0-9;]*m/g;
const visibleLen = (s) => String(s).replace(ANSI, '').length;
const padCell = (cell, width) => cell + ' '.repeat(Math.max(0, width - visibleLen(cell)));

/**
 * Render the collected rows as an aligned two-space-indented table.
 *
 * @param {NodeJS.WriteStream} stream
 * @param {{ headers: string[], rows: Array<{ label: string, outcome: object }>, toRow: (label: string, outcome: object) => string[] }} cfg
 */
function renderTable(stream, { headers, rows, toRow }) {
  const body = rows.map(({ label, outcome }) => toRow(label, outcome));
  const widths = headers.map((h, i) =>
    Math.max(visibleLen(h), ...body.map((cells) => visibleLen(cells[i] ?? ''))));
  // Two-space indent (matches the line reporter), two-space gutter between
  // columns, trailing whitespace trimmed so blank last cells leave no ragged tail.
  const line = (cells) =>
    ('  ' + cells.map((c, i) => padCell(c ?? '', widths[i])).join('  ')).replace(/\s+$/, '');

  stream.write(line(headers.map(gray)) + '\n');
  for (const cells of body) stream.write(line(cells) + '\n');
}

/**
 * Creates a table reporter.
 *
 * @param {object} cfg
 * @param {string[]} cfg.headers - Column titles.
 * @param {(label: string, outcome: object) => string[]} cfg.toRow - Map a
 *   settled task to its row cells (colored strings; one per header).
 * @param {NodeJS.WriteStream} [cfg.stream=process.stdout]
 * @returns {import('./reporter').Reporter}
 */
function createTableReporter({ headers, toRow, stream = process.stdout }) {
  /** @type {Array<{ label: string, outcome: object }>} */
  const rows = [];
  const rawLines = [];
  let activeStop = null;

  return {
    active(activeLabel) {
      activeStop = startHeartSpinner(activeLabel);
      const stop = activeStop;
      return (label, outcome) => {
        stop(); // clear the spinner line without printing a persistent line
        activeStop = null;
        rows.push({ label, outcome });
      };
    },

    instant(label, outcome) {
      rows.push({ label, outcome });
    },

    raw(text) {
      if (text) rawLines.push(text);
    },

    // The table owns its own footer; no per-run tally line.
    summary() {},

    finalize() {
      renderTable(stream, { headers, rows, toRow });
      for (const t of rawLines) stream.write(`${t}\n`);
    },

    pause() {
      if (activeStop) { activeStop(); activeStop = null; }
    },

    resume() {},
  };
}

module.exports = { createTableReporter };
