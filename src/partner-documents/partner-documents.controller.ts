import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PartnerDocumentsService } from './partner-documents.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

@Controller('partner-documents')
export class PartnerDocumentsController {
  constructor(private readonly partnerDocumentsService: PartnerDocumentsService) {}

  @Get()
  findPublic() {
    return this.partnerDocumentsService.findGroupedByYear();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  findAllAdmin() {
    return this.partnerDocumentsService.findAllAdmin();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, join(process.cwd(), 'uploads', 'documents'));
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.pdf';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(
            new BadRequestException('Only PDF and Word documents are allowed'),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('year') year?: string,
    @Body('titleRu') titleRu?: string,
    @Body('titleKz') titleKz?: string,
    @Body('titleEn') titleEn?: string,
    @Body('sortOrder') sortOrder?: string,
    @Body('isPublished') isPublished?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Document file is required');
    }

    const parsedYear = year ? Number.parseInt(year, 10) : NaN;
    if (!Number.isFinite(parsedYear)) {
      throw new BadRequestException('Valid year is required');
    }

    const parsedSortOrder = sortOrder ? Number.parseInt(sortOrder, 10) : 0;
    const url = `/uploads/documents/${file.filename}`;

    return this.partnerDocumentsService.create({
      year: parsedYear,
      titleRu: titleRu ?? '',
      titleKz,
      titleEn,
      url,
      sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : 0,
      isPublished: isPublished !== 'false' && isPublished !== '0',
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  remove(@Param('id') id: string) {
    return this.partnerDocumentsService.remove(id);
  }
}
