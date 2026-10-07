import { Module } from '@nestjs/common';

import { DrizzleModule } from '../db/drizzle.module';

import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';

@Module({
  imports: [DrizzleModule],
  controllers: [AirlinesController],
  providers: [AirlinesService],
})
export class AirlinesModule {}
