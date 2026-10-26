import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

import { FlightSyncService } from './flight-sync.service';
import { ScheduleRecognitionService } from './schedule-recognition.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE = 8 * 1024 * 1024;

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly flightSync: FlightSyncService, private readonly recognition: ScheduleRecognitionService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getBoard() {
    return this.flightSync.getScheduleBoard();
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  savePlan(@Body() body: { entries?: unknown[]; photoUrl?: string }) {
    if (!Array.isArray(body?.entries)) {
      throw new BadRequestException('Передайте список рейсов расписания');
    }
    return this.flightSync.saveSchedulePlan(body.entries, body.photoUrl);
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  syncNow() {
    return this.flightSync.triggerSync();
  }

  @Post('photo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const directory = join(process.cwd(), 'uploads', 'schedules');
          mkdirSync(directory, { recursive: true });
          cb(null, directory);
        },
        filename: (_req, file, cb) => {
          const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype] || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
          cb(
            new BadRequestException('Можно загрузить JPEG, PNG, WebP или GIF'),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Выберите фото расписания');
    }
    try {
      const parsed = await this.recognition.recognize(file.path);
      return { photoUrl: `/api/uploads/schedules/${file.filename}`, ...parsed };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }
}
