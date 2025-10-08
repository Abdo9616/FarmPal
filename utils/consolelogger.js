// consoleLogger.js
// This module overrides console.log, console.info, console.warn, and console.error to log messages to both the console and a single file.
// The file is determined at startup based on the start time.
// Structure: [logDir]/YYYY/MM/DD/YYYY MM DD_-_hh mm ss AM/PM.log (with padding in filename).
// It uses synchronous file operations for simplicity and reliability in logging.
// Strips ANSI escape codes (colors) from file logs.

// Require necessary modules
const fs = require('fs');
const path = require('path');
const util = require('util');

// Load environment variables from .env file (if present)
require('dotenv').config();

// Configuration from .env (create a .env file in your project root with these if you want to customize)
// Sample .env content:
// CONSOLE_LOG_DIR=./my-custom-logs  # Path to the base log directory (absolute or relative to project root). Default: ./console logs
// bot_timezone=Africa/Cairo  # IANA timezone name (e.g., Africa/Cairo, America/New_York). Default: UTC
const baseLogDir = process.env.CONSOLE_LOG_DIR || './console logs';
const timezone = process.env.bot_timezone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : (process.env.bot_timezone || 'UTC');

// ANSI color codes for console output
const green = '\x1b[32m'; // Green color
const blue = '\x1b[34m';  // Blue color
const reset = '\x1b[0m';  // Reset color
const cyan = '\x1b[36m';  // Cyan color
const yellow = '\x1b[33m';

// Function to get date parts in the specified timezone using Intl.DateTimeFormat
function getDateParts(date) {
  const options = {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const partMap = {};
  parts.forEach(part => {
    partMap[part.type] = part.value;
  });

  // Extract AM/PM (period)
  const period = partMap.dayPeriod || 'AM'; // Fallback, though it should always be present

  // Convert to numbers where needed
  return {
    year: partMap.year,
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
    period,
  };
}

// Function to pad numbers to 2 digits
function pad(num) {
  return (num + '').padStart(2, '0');
}

// Determine the log file path ONCE at startup
let logFilePath;
try {
  const startDate = new Date();
  const { year, month, day, hour, minute, second, period } = getDateParts(startDate);

  // Directory: baseLogDir/year/month/day (no padding for month/day in dirs)
  const yearDir = path.join(baseLogDir, year);
  const monthDir = path.join(yearDir, month.toString());
  const dayDir = path.join(monthDir, day.toString());

  // Filename: YYYY MM DD_-_hh mm ss AM/PM.log (with padding)
  const paddedMonth = pad(month);
  const paddedDay = pad(day);
  const paddedHour = pad(hour);
  const paddedMinute = pad(minute);
  const paddedSecond = pad(second);
  const fileName = `${year} ${paddedMonth} ${paddedDay}_-_${paddedHour} ${paddedMinute} ${paddedSecond} ${period}.log`;

  // Full file path
  logFilePath = path.join(dayDir, fileName);

  // Create directories if they don't exist (recursive, sync for simplicity)
  if (!fs.existsSync(dayDir)) {
    fs.mkdirSync(dayDir, { recursive: true });
  }
} catch (err) {
  console.error('Error setting up log file path:', err);
  // Fallback: log to console only if setup fails
  logFilePath = null;
}

// Function to strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Save original console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

// Generic logging function
function logToFile(level, ...args) {
  if (!logFilePath) return; // Skip if setup failed

  // Format the message like console does (handles %s, objects, etc.)
  let message = util.format(...args);

  // Strip ANSI colors
  message = stripAnsi(message);

  // Append newline
  message += '\n';

  // Append to the single file synchronously (optimized: append only, no rewrite or memory buffering)
  try {
    fs.appendFileSync(logFilePath, message, 'utf8');
  } catch (err) {
    originalConsole.error(`Error appending to log file (${logFilePath}):`, err);
  }
}

// Override console methods
console.log = function(...args) {
  originalConsole.log(...args);
  logToFile('log', ...args);
};

console.info = function(...args) {
  originalConsole.info(...args);
  logToFile('info', ...args);
};

console.warn = function(...args) {
  originalConsole.warn(...args);
  logToFile('warn', ...args);
};

console.error = function(...args) {
  originalConsole.error(...args);
  logToFile('error', ...args);
};

// Log a startup message for confirmation
originalConsole.log(`${yellow}Console logger initialized with log file:${reset} ${green}${logFilePath}${reset} ${yellow}and timezone:${reset} ${green}${timezone}${reset}`);