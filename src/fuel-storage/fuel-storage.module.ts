import { Module } from '@nestjs/common';

import { FuelStorageController } from './fuel-storage.controller';
import { FuelStorageService } from './fuel-storage.service';

@Module({
  controllers: [FuelStorageController],
  providers: [FuelStorageService],
  exports: [FuelStorageService],
})
export class FuelStorageModule {}
