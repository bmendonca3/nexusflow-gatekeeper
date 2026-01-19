/**
 * Logger Utility
 *
 * Centralized logging with pino for consistent log formatting
 */

import pino, { Logger } from 'pino';

const isDevelopment = import.meta.env.DEV || import.meta.env.NODE_ENV === 'development';

export const logger: Logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  base: {
    service: 'nexusflow-gatekeeper',
    version: '1.0.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with additional context
 */
export function createChildLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

export default logger;
