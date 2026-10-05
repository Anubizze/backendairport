import { Module } from '@nestjs/common';

import { ServicePhotosController } from './service-photos.controller';
import { ServicePhotosService } from './service-photos.service';

@Module({
  controllers: [ServicePhotosController],
  providers: [ServicePhotosService],
})
export class ServicePhotosModule {}
