/**
 * @fileoverview Public surface of the task-orchestration framework.
 *
 * The standardized spine every terminal, sequential toolkit script collapses
 * onto: define a typed `Task[]`, hand it to `runTasks`, and the shared reporter
 * owns the spinner, iconography, failure output, and summary tally.
 *
 * @module shared/tasks
 */

const { runTasks } = require('./run');
const { createReporter } = require('./reporter');
const { formatOutcome } = require('./status');

module.exports = {
  runTasks,
  createReporter,
  formatOutcome,
};
