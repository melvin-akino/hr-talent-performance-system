import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';

/** Unauthenticated by design -- used by Docker healthchecks and monitoring. */
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** Liveness: is the process up? Must not touch the database. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: can we actually serve traffic? */
  @Get('ready')
  async ready() {
    if (!(await this.db.healthy())) {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  }
}
