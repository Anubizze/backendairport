import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

import { DrizzleService } from '../db/drizzle.service';
import { partnerDocuments } from '../db/schema';

export type PartnerDocumentRecord = typeof partnerDocuments.$inferSelect;

@Injectable()
export class PartnerDocumentsService implements OnModuleInit {
  constructor(private readonly drizzle: DrizzleService) {}

  async onModuleInit() {
    await this.ensureStorage();
  }

  async findGroupedByYear() {
    const rows = await this.drizzle.db
      .select()
      .from(partnerDocuments)
      .where(eq(partnerDocuments.isPublished, true))
      .orderBy(
        desc(partnerDocuments.year),
        asc(partnerDocuments.sortOrder),
        asc(partnerDocuments.createdAt),
      );

    const grouped = new Map<number, PartnerDocumentRecord[]>();
    for (const row of rows) {
      const list = grouped.get(row.year) ?? [];
      list.push(row);
      grouped.set(row.year, list);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, documents]) => ({ year, documents }));
  }

  async findAllAdmin() {
    return this.drizzle.db
      .select()
      .from(partnerDocuments)
      .orderBy(
        desc(partnerDocuments.year),
        asc(partnerDocuments.sortOrder),
        asc(partnerDocuments.createdAt),
      );
  }

  async create(params: {
    year: number;
    titleRu: string;
    titleKz?: string;
    titleEn?: string;
    url: string;
    sortOrder?: number;
    isPublished?: boolean;
  }) {
    if (!Number.isFinite(params.year) || params.year < 1990 || params.year > 2100) {
      throw new BadRequestException('Valid year is required');
    }

    const titleRu = params.titleRu.trim();
    if (!titleRu) {
      throw new BadRequestException('Title is required');
    }

    const [created] = await this.drizzle.db
      .insert(partnerDocuments)
      .values({
        year: params.year,
        titleRu,
        titleKz: params.titleKz?.trim() || titleRu,
        titleEn: params.titleEn?.trim() || titleRu,
        url: params.url,
        sortOrder: params.sortOrder ?? 0,
        isPublished: params.isPublished ?? true,
      })
      .returning();

    return created;
  }

  async remove(id: string) {
    const [existing] = await this.drizzle.db
      .select()
      .from(partnerDocuments)
      .where(eq(partnerDocuments.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Document not found');
    }

    await this.drizzle.db.delete(partnerDocuments).where(eq(partnerDocuments.id, id));

    const relativePath = existing.url.replace(/^\/uploads\//, '');
    const absolutePath = join(process.cwd(), 'uploads', relativePath);
    if (existsSync(absolutePath)) {
      await unlink(absolutePath).catch(() => undefined);
    }

    return { success: true };
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS "partner_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "year" integer NOT NULL,
        "title_ru" varchar(255) NOT NULL,
        "title_kz" varchar(255),
        "title_en" varchar(255),
        "url" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "is_published" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await this.drizzle.db.execute(sql`
      CREATE INDEX IF NOT EXISTS "partner_documents_year_idx"
      ON "partner_documents" ("year" DESC, "sort_order" ASC);
    `);
  }
}
