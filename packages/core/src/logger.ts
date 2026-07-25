import { pino, stdSerializers } from 'pino';

/** Mapping niveaux pino → severity Cloud Logging. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  messageKey: 'message',
  serializers: { err: stdSerializers.err },
  formatters: {
    level(label) {
      return { severity: SEVERITY[label] ?? 'INFO' };
    },
  },
});
