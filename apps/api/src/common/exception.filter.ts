import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

/**
 * Logs every failed request and shapes the response.
 *
 * Nest's built-in filter returns a bare 500 and, with the framework logger
 * disabled, writes nothing at all -- an unhandled exception becomes an
 * invisible failure. On an on-prem box with no APM, the log file is the only
 * diagnostic there is, so every 5xx must leave a trace with its stack and
 * request id.
 */
interface PgError { code?: string; message?: string }

function isPgError(e: unknown): e is PgError & { code: string } {
  return typeof e === 'object' && e !== null && typeof (e as PgError).code === 'string';
}

/**
 * A policy's WITH CHECK failure arrives as a check_violation whose message names
 * row-level security. Matching on the message is unpleasant but the alternative
 * — treating every check_violation as a permission denial — would hide genuine
 * data-integrity bugs behind a 403.
 */
function isRlsCheck(e: PgError & { code: string }): boolean {
  return e.code === '23514' && /row-level security/i.test(e.message ?? '');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    // Zod failures are the caller's problem, not a server fault.
    if (exception instanceof ZodError) {
      logger.debug({ requestId, issues: exception.issues }, 'request validation failed');
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: exception.issues
          .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join('; '),
        errors: exception.issues,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // 4xx is expected traffic; only 5xx indicates something is broken.
      if (status >= 500) {
        logger.error({ err: exception, requestId, path: req.url }, 'request failed');
      } else {
        logger.debug({ requestId, status, path: req.url }, 'request rejected');
      }
      res.status(status).json(
        typeof body === 'object' ? body : { statusCode: status, message: body });
      return;
    }

    // Row-level security is the authorization mechanism (D-003), so a denied
    // request surfaces here as a PostgreSQL error rather than an HttpException.
    // Reporting that as 500 is wrong three times over: the user is told the
    // server is broken when they simply lack permission, the log fills with
    // "unhandled exception" for entirely routine traffic, and any alert on 5xx
    // fires every time somebody clicks something they may not do.
    //
    //   42501  insufficient_privilege — RLS policy or a missing table grant
    //   23514  check_violation from a WITH CHECK clause on an RLS policy
    if (isPgError(exception) && (exception.code === '42501' || isRlsCheck(exception))) {
      logger.debug(
        { requestId, path: req.url, method: req.method, pgCode: exception.code },
        'request denied by row-level security');
      res.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN,
        // Deliberately generic. Naming the row or policy would tell the caller
        // that a record they may not read exists.
        message: 'You do not have permission to perform this action',
        requestId,
      });
      return;
    }

    logger.error(
      { err: exception, requestId, path: req.url, method: req.method },
      'unhandled exception');

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      // Never leak internals to the client; the detail is in the log, keyed by
      // the request id the caller already has.
      message: 'Internal server error',
      requestId,
    });
  }
}
