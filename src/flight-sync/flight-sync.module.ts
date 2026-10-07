import { Module } from '@nestjs/common';

import { DrizzleModule } from '../db/drizzle.module';
import { FlightsModule } from '../flights/flights.module';

import { FlightSyncService } from './flight-sync.service';
import { ScheduleController } from './schedule.controller';

@Module({
  imports: [DrizzleModule, FlightsModule],
  controllers: [ScheduleController],
  providers: [FlightSyncService],
})
export class FlightSyncModule {}
