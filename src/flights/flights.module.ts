import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { FlightsController } from './flights.controller';
import { FlightsEventsService } from './flights.events';
import { FlightsService } from './flights.service';

@Module({
  imports: [NotificationsModule],
  controllers: [FlightsController],
  providers: [FlightsService, FlightsEventsService],
  exports: [FlightsEventsService],
})
export class FlightsModule {}
