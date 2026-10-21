import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';

import { DrizzleService } from '../db/drizzle.service';
import { servicePhotos } from '../db/schema';
import { isValidServiceId, normalizeServiceId } from './service-ids';
import { UpdateServicePhotoDto } from './dto/update-service-photo.dto';

export type ServicePhotoRecord = typeof servicePhotos.$inferSelect;

@Injectable()
export class ServicePhotosService {
  constructor(private readonly drizzle: DrizzleService) {}

  async findGroupedByService() {
    const rows = await this.drizzle.db
      .select()
      .from(servicePhotos)
      .orderBy(asc(servicePhotos.serviceId), asc(servicePhotos.sortOrder), asc(servicePhotos.createdAt));

    const grouped: Record<string, ServicePhotoRecord[]> = {};
    for (const row of rows) {
      const serviceId = normalizeServiceId(row.serviceId);
      if (!grouped[serviceId]) grouped[serviceId] = [];
      grouped[serviceId].push(row);
    }
    return grouped;
  }

  async findAll() {
    return this.drizzle.db
      .select()
      .from(servicePhotos)
      .orderBy(asc(servicePhotos.serviceId), asc(servicePhotos.sortOrder), asc(servicePhotos.createdAt));
  }

  async create(params: {
    serviceId: string;
    url: string;
    altRu?: string;
    altKz?: string;
    altEn?: string;
    sortOrder?: number;
  }) {
    const serviceId = normalizeServiceId(params.serviceId);
    if (!isValidServiceId(serviceId)) {
      throw new BadRequestException('Unknown service id');
    }

    const [created] = await this.drizzle.db
      .insert(servicePhotos)
      .values({
        serviceId,
        url: params.url,
        altRu: params.altRu?.trim() || null,
        altKz: params.altKz?.trim() || null,
        altEn: params.altEn?.trim() || null,
        sortOrder: params.sortOrder ?? 0,
      })
      .returning();

    return created;
  }

  async update(id: string, params: UpdateServicePhotoDto, file?: Express.Multer.File) {
    const [existing] = await this.drizzle.db
      .select()
      .from(servicePhotos)
      .where(eq(servicePhotos.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException('Фото не найдено');

    const serviceId = normalizeServiceId(params.serviceId ?? existing.serviceId);
    if (!isValidServiceId(serviceId)) throw new BadRequestException('Неизвестная услуга');

    let url = existing.url;
    if (file) {
      const extensions: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      };
      const extension = extensions[file.mimetype];
      if (!extension) throw new BadRequestException('Недопустимый формат изображения');
      const directory = join(process.cwd(), 'uploads', 'services');
      await mkdir(directory, { recursive: true });
      const filename = `${randomUUID()}${extension}`;
      await writeFile(join(directory, filename), file.buffer);
      url = `/uploads/services/${filename}`;
    }

    let updated: ServicePhotoRecord;
    try {
      [updated] = await this.drizzle.db.update(servicePhotos).set({
        serviceId,
        url,
        altRu: params.altRu === undefined ? existing.altRu : params.altRu?.trim() || null,
        altKz: params.altKz === undefined ? existing.altKz : params.altKz?.trim() || null,
        altEn: params.altEn === undefined ? existing.altEn : params.altEn?.trim() || null,
        sortOrder: params.sortOrder ?? existing.sortOrder,
      }).where(eq(servicePhotos.id, id)).returning();
      if (!updated) throw new NotFoundException('Фото не найдено');
    } catch (error) {
      if (file) await this.removeLocalFile(url);
      throw error;
    }
    if (file && url !== existing.url) await this.removeLocalFile(existing.url);
    return updated;
  }

  private async removeLocalFile(url: string) {
    const prefix = '/uploads/services/';
    if (!url.startsWith(prefix)) return;
    const filename = url.slice(prefix.length);
    if (!filename || basename(filename) !== filename) return;
    await unlink(join(process.cwd(), 'uploads', 'services', filename)).catch(() => undefined);
  }

  async remove(id: string) {
    const [existing] = await this.drizzle.db
      .select()
      .from(servicePhotos)
      .where(eq(servicePhotos.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Photo not found');
    }

    await this.drizzle.db.delete(servicePhotos).where(eq(servicePhotos.id, id));

    await this.removeLocalFile(existing.url);

    return { success: true };
  }
}
