import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { config } from './config/config';
import { logger } from './common/logger';
import { AllExceptionsFilter } from './common/exception.filter';
import { NotificationWorkerService } from './notifications/notification-worker.service';

/**
 * Everything that turns a bare Nest app into *this* API: the route prefix, the
 * security headers, the error shape, the correlation id.
 *
 * Exported so the HTTP tests exercise the same wiring the server runs. Building
 * the test app separately would mean the global prefix, the exception filter and
 * the request-id header are all untested — and any of those changing without the
 * tests noticing is precisely the drift the tests exist to catch.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  // Correlation id, propagated into audit_log via app.request_id.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  });

  // CORS is intentionally NOT enabled: Caddy serves the SPA and the API from
  // the same origin (ops/caddy/Caddyfile), so cross-origin requests to this
  // API are not a legitimate access pattern.
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  configureApp(app);

  app.enableShutdownHooks();

  // Started after the app is wired but before listening, so a queued
  // notification from a previous run is picked up promptly on restart.
  app.get(NotificationWorkerService).start();

  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
}

// Only start a server when this file is the entry point. Without the guard,
// importing configureApp from a test would boot a real HTTP listener and a
// notification worker as a side effect of the import.
if (require.main === module) {
  bootstrap().catch((err) => {
    logger.fatal({ err }, 'failed to start');
    process.exit(1);
  });
}
