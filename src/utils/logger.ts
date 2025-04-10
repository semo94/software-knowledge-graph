import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { LOG_LEVEL, LOG_DIR, LOG_FILE, ERROR_LOG_FILE, ENABLE_FILE_LOGGING } from './config.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Resolve the log directory path safely
// If LOG_DIR is an absolute path, use it directly
// If LOG_DIR is a relative path, resolve it relative to the current working directory
const absoluteLogDir = LOG_DIR.startsWith('/') 
  ? LOG_DIR // Already absolute
  : path.resolve(process.cwd(), LOG_DIR);

// Ensure log directory exists
try {
  if (!fs.existsSync(absoluteLogDir)) {
    fs.mkdirSync(absoluteLogDir, { recursive: true });
    console.info(`Created log directory: ${absoluteLogDir}`);
  }
} catch (error) {
  console.error(`Failed to create log directory (${absoluteLogDir}): ${error}`);
}

// Create winston logger instance
export const logger = winston.createLogger({
  levels,
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'software-knowledge-graph' },
  transports: [
    // Console transport for development - redirected to stderr
    new winston.transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'debug'], // Send ALL logs to stderr
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // Filter out service from meta to avoid duplication
          const { service, ...rest } = meta;
          const metaStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

// Add file transports when enabled
if (ENABLE_FILE_LOGGING) {
  try {
    // Add error log file transport
    logger.add(
      new winston.transports.File({ 
        filename: path.join(absoluteLogDir, ERROR_LOG_FILE), 
        level: 'error' 
      })
    );
    
    // Add combined log file transport
    logger.add(
      new winston.transports.File({ 
        filename: path.join(absoluteLogDir, LOG_FILE)
      })
    );
    
    logger.info(`File logging enabled: ${path.join(absoluteLogDir, LOG_FILE)}`);
  } catch (error) {
    console.error(`Failed to initialize file logging: ${error}`);
  }
}

// Add stream for stderr logging (useful for debugging)
export const logStream = {
  write: (message: string) => {
    logger.debug(message.trim());
  },
};

// Update log level dynamically
export function setLogLevel(level: string): void {
  if (Object.keys(levels).includes(level)) {
    logger.level = level;
    logger.info(`Log level set to ${level}`);
  } else {
    logger.warn(`Invalid log level: ${level}. Using current level: ${logger.level}`);
  }
} 