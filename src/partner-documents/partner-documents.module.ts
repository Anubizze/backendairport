import { Module } from '@nestjs/common';

import { PartnerDocumentsController } from './partner-documents.controller';
import { PartnerDocumentsService } from './partner-documents.service';

@Module({
  controllers: [PartnerDocumentsController],
  providers: [PartnerDocumentsService],
  exports: [PartnerDocumentsService],
})
export class PartnerDocumentsModule {}
