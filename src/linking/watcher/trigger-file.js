/**
 * @fileoverview Trigger-file management — path, creation, write, cleanup
 */

const fs = require('fs');
const path = require('path');
const { removeFile } = require('../../shared/fs-utils');
const { info, warn, cyan, gray } = require('../../shared/logger');
const { TRIGGER_FILE_NAME, TRIGGER_FILE_CONTENT } = require('./constants');

/**
 * Gets the path to the trigger file in the project's src directory
 *
 * @param {string} projectDir - Project root directory
 * @returns {string} Absolute path to trigger file
 */
function getTriggerFilePath(projectDir) {
  return path.join(projectDir, 'src', TRIGGER_FILE_NAME);
}

/**
 * Creates or updates the trigger file with a new timestamp
 *
 * @param {string} projectDir - Project root directory
 * @param {string} changedPackage - Name of the package that changed
 */
function touchTriggerFile(projectDir, changedPackage) {
  const triggerPath = getTriggerFilePath(projectDir);
  const timestamp = Date.now();
  const content = `${TRIGGER_FILE_CONTENT}${timestamp};\n// Last change: ${changedPackage} at ${new Date(timestamp).toISOString()}\n`;

  try {
    fs.writeFileSync(triggerPath, content, 'utf-8');
  } catch (e) {
    warn(`Could not write trigger file: ${e.message}`);
  }
}


/**
 * Ensures the trigger file exists and is imported by the app
 *
 * @param {string} projectDir - Project root directory
 * @returns {boolean} True if trigger file was created/verified
 */
function ensureTriggerFile(projectDir) {
  const triggerPath = getTriggerFilePath(projectDir);
  const srcDir = path.join(projectDir, 'src');

  // Check if src directory exists
  if (!fs.existsSync(srcDir)) {
    warn(`No src/ directory found in ${projectDir}`);
    return false;
  }

  // Create trigger file if it doesn't exist
  if (!fs.existsSync(triggerPath)) {
    const timestamp = Date.now();
    const content = `${TRIGGER_FILE_CONTENT}${timestamp};\n// Created by nice-toolkit --watch\n`;
    fs.writeFileSync(triggerPath, content, 'utf-8');
    info(`Created trigger file: ${gray(TRIGGER_FILE_NAME)}`);
    info(`Add to your entry file: ${cyan(`import './${TRIGGER_FILE_NAME}'`)}`);
    info(`Add to .gitignore: ${cyan(TRIGGER_FILE_NAME)}`);
  }

  return true;
}

/**
 * Removes the trigger file from the project
 *
 * @param {string} projectDir - Project root directory
 */
function cleanupTriggerFile(projectDir) {
  const triggerPath = getTriggerFilePath(projectDir);

  if (fs.existsSync(triggerPath)) {
    removeFile(triggerPath);
    info(`Removed trigger file: ${TRIGGER_FILE_NAME}`);
  }
}

module.exports = {
  getTriggerFilePath,
  touchTriggerFile,
  ensureTriggerFile,
  cleanupTriggerFile,
};
