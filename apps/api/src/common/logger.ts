import pino from 'pino';
import { config } from '../config/config';

/**
 * Structured JSON logging (global rules: structured logging).
 *
 * The redaction list is not decoration. This system logs around HR records;
 * a stray `logger.info({ employee })` must not put personal data or a bearer
 * token into a log file that is backed up nightly and read by whoever is
 * debugging at the time.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'token',
      '*.token',
      '*.work_email',
      '*.personal_email',
      '*.idp_subject',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // ISO timestamps: log files are read by humans on a server console, and
  // epoch millis are not.
  timestamp: pino.stdTimeFunctions.isoTime,
});
