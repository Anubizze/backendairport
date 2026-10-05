import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { DRIZZLE_DB, DrizzleService, PG_POOL } from './drizzle.service';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool =>
        DrizzleService.createPool(configService),
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => DrizzleService.createDb(pool),
    },
    DrizzleService,
  ],
  exports: [DrizzleService, DRIZZLE_DB, PG_POOL],
})
export class DrizzleModule {}
