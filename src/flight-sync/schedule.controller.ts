import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
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

import { FlightSyncService } from './flight-sync.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE = 8 * 1024 * 1024;

type ScheduleEntryBody = {
  weekday: number;
  flightNumber: string;
  direction: string;
  city: string;
  time: string;
};

@Controller('schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin', 'dispatcher')
export class ScheduleController {
  constructor(private readonly flightSync: FlightSyncService) {}

  @Get()
  getBoard() {
    return this.flightSync.getScheduleBoard();
  }

  @Put()
  savePlan(@Body() body: { entries?: ScheduleEntryBody[] }) {
    if (!Array.isArray(body?.entries)) {
      throw new BadRequestException('Передайте список рейсов расписания');
    }
    return this.flightSync.saveSchedulePlan(body.entries);
  }

  @Post('sync')
  syncNow() {
    return this.flightSync.triggerSync();
  }

  @Post('photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, join(process.cwd(), 'uploads', 'schedules'));
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase() || '.jpg';
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
  uploadPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Выберите фото расписания');
    }
    return this.flightSync.saveSchedulePhoto(`/api/uploads/schedules/${file.filename}`);
  }
}
