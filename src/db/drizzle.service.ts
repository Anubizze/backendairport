import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

@Injectable()
export class DrizzleService implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE_DB)
    readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {}

  static createPool(configService: ConfigService): Pool {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }
    return new Pool({
      connectionString,
      max: configService.get<number>('PG_POOL_MAX', 5),
      min: 0,
      idleTimeoutMillis: configService.get<number>('PG_IDLE_TIMEOUT_MS', 10000),
      connectionTimeoutMillis: configService.get<number>('PG_CONNECT_TIMEOUT_MS', 5000),
    });
  }

  static createDb(pool: Pool): NodePgDatabase<typeof schema> {
    return drizzle(pool, { schema });
  }

  get redisUrl(): string {
    return this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
