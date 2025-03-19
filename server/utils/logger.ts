// Simple logging utility
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'app.log');

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type LogMessage = string | object;

function log(level: LogLevel, message: LogMessage): void {
  const timestamp = new Date().toISOString();
  
  // Plain message for file
  const fileMessage = `[${timestamp}] [${level}] ${typeof message === 'object' ? JSON.stringify(message) : message}\n`;
  
  // Colored message for console
  let consoleColor = colors.reset;
  let emoji = 'ℹ️';
  
  switch (level) {
    case 'ERROR':
      consoleColor = colors.red;
      emoji = '❌';
      break;
    case 'WARN':
      consoleColor = colors.yellow;
      emoji = '⚠️';
      break;
    case 'INFO':
    default:
      consoleColor = colors.cyan;
      emoji = 'ℹ️';
  }

  // Special formatting for queue status
  if (typeof message === 'string' && message.includes('Queue Status:')) {
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${consoleColor}[${level}]${colors.reset} ${emoji}`);
    console.log(`${colors.magenta}${message}${colors.reset}`);
  } else {
    // Format objects if needed
    const displayMessage = typeof message === 'object' 
      ? JSON.stringify(message, null, 2)
      : message;
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${consoleColor}[${level}]${colors.reset} ${emoji} ${displayMessage}`);
  }
  
  // Log to file (without colors)
  fs.appendFileSync(logFile, fileMessage);
}

export const logger = {
  info: (message: LogMessage): void => log('INFO', message),
  warn: (message: LogMessage): void => log('WARN', message),
  error: (message: LogMessage): void => log('ERROR', message),
};