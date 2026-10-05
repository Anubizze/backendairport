import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

import { DrizzleService } from '../db/drizzle.service';
import { servicePhotos } from '../db/schema';
import { isValidServiceId, normalizeServiceId } from './service-ids';

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

    const relativePath = existing.url.replace(/^\/uploads\//, '');
    const absolutePath = join(process.cwd(), 'uploads', relativePath);
    if (existsSync(absolutePath)) {
      await unlink(absolutePath).catch(() => undefined);
    }

    return { success: true };
  }
}
