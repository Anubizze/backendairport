import { Module } from '@nestjs/common';

import { DrizzleModule } from '../db/drizzle.module';
import { FlightsModule } from '../flights/flights.module';

import { FlightSyncService } from './flight-sync.service';

@Module({
  imports: [DrizzleModule, FlightsModule],
  providers: [FlightSyncService],
})
export class FlightSyncModule {}
