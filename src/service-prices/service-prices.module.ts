import { Module } from '@nestjs/common';

import { DrizzleModule } from '../db/drizzle.module';

import { ServicePricesController } from './service-prices.controller';
import { ServicePricesService } from './service-prices.service';

@Module({
  imports: [DrizzleModule],
  controllers: [ServicePricesController],
  providers: [ServicePricesService],
})
export class ServicePricesModule {}