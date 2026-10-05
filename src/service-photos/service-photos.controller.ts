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
import { isValidServiceId } from './service-ids';
import { ServicePhotosService } from './service-photos.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Controller('service-photos')
export class ServicePhotosController {
  constructor(private readonly servicePhotosService: ServicePhotosService) {}

  @Get()
  findPublic() {
    return this.servicePhotosService.findGroupedByService();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  findAllAdmin() {
    return this.servicePhotosService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, join(process.cwd(), 'uploads', 'services'));
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(new BadRequestException('Only JPEG, PNG, WebP and GIF images are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('serviceId') serviceId: string,
    @Body('altRu') altRu?: string,
    @Body('altKz') altKz?: string,
    @Body('altEn') altEn?: string,
    @Body('sortOrder') sortOrder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    if (!serviceId || !isValidServiceId(serviceId)) {
      throw new BadRequestException('Valid serviceId is required');
    }

    const url = `/uploads/services/${file.filename}`;
    const parsedSortOrder = sortOrder ? Number.parseInt(sortOrder, 10) : 0;

    return this.servicePhotosService.create({
      serviceId,
      url,
      altRu,
      altKz,
      altEn,
      sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : 0,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  remove(@Param('id') id: string) {
    return this.servicePhotosService.remove(id);
  }
}
