import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

import { DrizzleService } from '../db/drizzle.service';
import { airlines } from '../db/schema';

@Injectable()
export class AirlinesService implements OnModuleInit {
  constructor(private readonly drizzle: DrizzleService) {}

  async onModuleInit() {
    await this.ensureStorage();
  }

  async findAll() {
    await this.ensureStorage();
    return this.drizzle.db.select().from(airlines).orderBy(asc(airlines.sortOrder), asc(airlines.name));
  }

  async save(params: {
    name: string;
    code: string;
    websiteUrl?: string;
    description?: string;
    logoUrl?: string;
  }) {
    await this.ensureStorage();
    const name = params.name?.trim();
    const code = params.code?.trim().toUpperCase();
    const websiteUrl = params.websiteUrl?.trim() || null;
    const description = params.description?.trim() || null;

    if (!name) {
      throw new BadRequestException('Укажите название авиакомпании');
    }
    if (!/^[A-Z0-9]{2,3}$/.test(code)) {
      throw new BadRequestException('Код авиакомпании: 2–3 буквы, например IQ');
    }
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) {
      throw new BadRequestException('Ссылка должна начинаться с http:// или https://');
    }

    const [existing] = await this.drizzle.db
      .select()
      .from(airlines)
      .where(eq(airlines.code, code))
      .limit(1);

    if (existing) {
      if (params.logoUrl && existing.logoUrl) {
        await this.removeFile(existing.logoUrl);
      }
      const [updated] = await this.drizzle.db
        .update(airlines)
        .set({
          name,
          websiteUrl,
          description,
          ...(params.logoUrl ? { logoUrl: params.logoUrl } : {}),
        })
        .where(eq(airlines.id, existing.id))
        .returning();
      return updated;
    }

    if (!params.logoUrl) {
      throw new BadRequestException('Загрузите логотип');
    }

    const current = await this.findAll();
    const sortOrder = current.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    const [created] = await this.drizzle.db
      .insert(airlines)
      .values({
        name,
        code,
        logoUrl: params.logoUrl,
        websiteUrl,
        description,
        sortOrder,
      })
      .returning();
    return created;
  }

  async remove(id: string) {
    await this.ensureStorage();
    const [existing] = await this.drizzle.db
      .select()
      .from(airlines)
      .where(eq(airlines.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException('Авиакомпания не найдена');
    }

    await this.drizzle.db.delete(airlines).where(eq(airlines.id, id));
    if (existing.logoUrl) {
      await this.removeFile(existing.logoUrl);
    }
    return { deleted: true, id };
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS airlines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL,
        code varchar(8) NOT NULL,
        logo_url text,
        website_url text,
        description varchar(255),
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.drizzle.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS airlines_code_unique ON airlines (code)
    `);
  }

  private async removeFile(url: string) {
    const filename = url.split('/').pop();
    if (!filename) return;
    const filePath = join(process.cwd(), 'uploads', 'airlines', filename);
    if (!existsSync(filePath)) return;
    await unlink(filePath).catch(() => undefined);
  }
}
