/**
 * @fileoverview Writes a timestamped `--reset --log` report file.
 *
 * `--reset` runs build-all → dedupe → clean and normally streams everything to
 * the terminal. With `--log`, the build phase captures each failing package's
 * output; this module persists a shareable summary + those failure logs to
 * `{workspaceRoot}/.nice/reset-{timestamp}.log` so it can be handed off (e.g.
 * pasted to an assistant) after the run.
 *
 * @module cli/reset-log
 */

const fs = require('fs');
const path = require('path');

/** Strip ANSI color codes so the file is plain text. */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\[[0-9;]*m/g, '');
}

/**
 * Write the reset build result to a timestamped log file.
 *
 * @param {string} workspaceRoot - Absolute workspace root (registry basePath)
 * @param {{ built: string[], skipped: string[], failed: string[], output?: Object<string,string> }} result
 * @returns {string} Absolute path of the written log file
 */
function writeResetLog(workspaceRoot, result) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

  const dir = path.join(workspaceRoot, '.nice');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `reset-${ts}.log`);

  const lines = [
    'nice-toolkit --reset log',
    `generated: ${now.toISOString()}`,
    '',
    `built:   ${result.built.length}  [${result.built.join(', ')}]`,
    `skipped: ${result.skipped.length}  [${result.skipped.join(', ')}]`,
    `failed:  ${result.failed.length}  [${result.failed.join(', ')}]`,
    '',
  ];

  if (result.failed.length > 0) {
    lines.push('='.repeat(72), 'FAILURE OUTPUT', '='.repeat(72));
    for (const name of result.failed) {
      const captured = result.output && result.output[name];
      lines.push('', `### ${name}`, '', captured ? stripAnsi(captured) : '(no output captured)');
    }
  } else {
    lines.push('All builds succeeded.');
  }

  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

module.exports = { writeResetLog };
