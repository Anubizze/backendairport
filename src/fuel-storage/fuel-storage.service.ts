import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { fuelStorageContent } from '../db/schema';

type FuelPriceRow = {
  name: string;
  unit: string;
  price: string;
  sortOrder: number;
};

type FuelStoragePublicData = {
  capacityDate: string;
  capacityTons: string;
  priceRowsRu: FuelPriceRow[];
  priceRowsKz: FuelPriceRow[];
  priceRowsEn: FuelPriceRow[];
  priceRows: FuelPriceRow[];
  documentsRu: string[];
  documentsKz: string[];
  documentsEn: string[];
  documents: string[];
  submitEmail: string;
  contactPhone: string;
  updatedAt: string | null;
};

type FuelStorageUpdatePayload = {
  capacityDate?: string;
  capacityTons?: string;
  priceRowsRu?: FuelPriceRow[];
  priceRowsKz?: FuelPriceRow[];
  priceRowsEn?: FuelPriceRow[];
  priceRows?: FuelPriceRow[];
  documentsRu?: string[];
  documentsKz?: string[];
  documentsEn?: string[];
  documents?: string[];
  submitEmail?: string;
  contactPhone?: string;
};

const DEFAULT_PRICE_ROWS_RU: FuelPriceRow[] = [
  {
    name: 'Услуги по хранению ГСМ',
    unit: 'за 1 тн (тонна) за хранение ГСМ',
    price: 'по запросу',
    sortOrder: 0,
  },
  {
    name: 'Приём авиатоплива на склад ГСМ и внутренняя перекачка',
    unit: 'за 1 тн',
    price: 'по запросу',
    sortOrder: 1,
  },
];

const DEFAULT_PRICE_ROWS_KZ: FuelPriceRow[] = [
  {
    name: 'Жанармай сақтау қызметтері',
    unit: 'сақтауға қабылданған жанар-жағармайдың 1 тоннасына',
    price: 'сұраныс бойынша',
    sortOrder: 0,
  },
  {
    name: 'Жанар-жағармай қоймасына авиациялық отынды қабылдау және ішкі перекачка',
    unit: '1 тоннаға',
    price: 'сұраныс бойынша',
    sortOrder: 1,
  },
];

const DEFAULT_PRICE_ROWS_EN: FuelPriceRow[] = [
  {
    name: 'Fuel storage services',
    unit: 'per 1 ton stored',
    price: 'on request',
    sortOrder: 0,
  },
  {
    name: 'Receipt of aviation fuel at the depot and internal pumping',
    unit: 'per 1 ton',
    price: 'on request',
    sortOrder: 1,
  },
];

const DEFAULT_DOCUMENTS_RU = [
  'Договор на поставку авиатоплива между поставщиком авиатоплива и авиакомпанией',
  'Свидетельство о государственной регистрации (перерегистрации) юридического лица или свидетельство о регистрации индивидуального предпринимателя',
  'Информация о запрашиваемых объёмах хранения, включая сроки и объёмы хранения',
  'Сертификат качества авиационного топлива',
  'Документ, подтверждающий происхождение авиационного топлива',
  'Документ, подтверждающий право собственности на объём авиационного топлива, планируемого к хранению',
];

const DEFAULT_DOCUMENTS_KZ = [
  'Авиациялық отынды жеткізуші мен авиакомпания арасындағы авиациялық отынды жеткізу туралы келісім',
  'Заңды тұлғаны/жеке кәсіпкерді мемлекеттік тіркеу/қайта тіркеу туралы куәліктің немесе куәліктің көшірмесі',
  'Сақтау мерзімдері мен көлемдерін қоса алғанда, сұралған сақтау көлемдері туралы ақпарат',
  'Авиациялық отынның сапа сертификаты',
  'Авиациялық отынның шығу тегін растайтын құжат',
  'Сақтауға жоспарланған авиациялық отын көлеміне меншік құқығын растайтын құжат',
];

const DEFAULT_DOCUMENTS_EN = [
  'Aviation fuel supply agreement between the fuel supplier and the airline',
  'Certificate of state registration (re-registration) of a legal entity or individual entrepreneur',
  'Information on requested storage volumes, including terms and quantities',
  'Aviation fuel quality certificate',
  'Document confirming the origin of the aviation fuel',
  'Document confirming ownership of the aviation fuel volume planned for storage',
];

@Injectable()
export class FuelStorageService implements OnModuleInit {
  constructor(private readonly drizzle: DrizzleService) {}

  async onModuleInit() {
    await this.ensureStorage();
  }

  async getPublicData(): Promise<FuelStoragePublicData> {
    const row = await this.getOrCreateRow();
    return this.mapRow(row);
  }

  async update(payload: Record<string, unknown>): Promise<FuelStoragePublicData> {
    const row = await this.getOrCreateRow();
    const prepared = this.preparePayload(payload);

    const [updated] = await this.drizzle.db
      .update(fuelStorageContent)
      .set({
        capacityDate: prepared.capacityDate,
        capacityTons: prepared.capacityTons,
        priceRowsJson: JSON.stringify(prepared.priceRowsRu),
        priceRowsRuJson: JSON.stringify(prepared.priceRowsRu),
        priceRowsKzJson: JSON.stringify(prepared.priceRowsKz),
        priceRowsEnJson: JSON.stringify(prepared.priceRowsEn),
        documentsJson: JSON.stringify(prepared.documentsRu),
        documentsRuJson: JSON.stringify(prepared.documentsRu),
        documentsKzJson: JSON.stringify(prepared.documentsKz),
        documentsEnJson: JSON.stringify(prepared.documentsEn),
        submitEmail: prepared.submitEmail,
        contactPhone: prepared.contactPhone,
        updatedAt: new Date(),
      })
      .where(eq(fuelStorageContent.id, row.id))
      .returning();

    return this.mapRow(updated);
  }

  private async getOrCreateRow() {
    const [existing] = await this.drizzle.db
      .select()
      .from(fuelStorageContent)
      .where(eq(fuelStorageContent.contentKey, 'default'))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await this.drizzle.db
      .insert(fuelStorageContent)
      .values({
        contentKey: 'default',
        capacityDate: '',
        capacityTons: '',
        priceRowsJson: JSON.stringify(DEFAULT_PRICE_ROWS_RU),
        priceRowsRuJson: JSON.stringify(DEFAULT_PRICE_ROWS_RU),
        priceRowsKzJson: JSON.stringify(DEFAULT_PRICE_ROWS_KZ),
        priceRowsEnJson: JSON.stringify(DEFAULT_PRICE_ROWS_EN),
        documentsJson: JSON.stringify(DEFAULT_DOCUMENTS_RU),
        documentsRuJson: JSON.stringify(DEFAULT_DOCUMENTS_RU),
        documentsKzJson: JSON.stringify(DEFAULT_DOCUMENTS_KZ),
        documentsEnJson: JSON.stringify(DEFAULT_DOCUMENTS_EN),
        submitEmail: 'airportsemey@mail.kz',
        contactPhone: '8 (7222) 36-00-33',
      })
      .returning();

    return created;
  }

  private mapRow(row: typeof fuelStorageContent.$inferSelect): FuelStoragePublicData {
    const normalizePriceRows = (raw: FuelPriceRow[]) =>
      raw
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          name: this.cleanText(item.name),
          unit: this.cleanText(item.unit),
          price: this.cleanText(item.price),
          sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
        }))
        .filter((item) => item.name && item.unit && item.price)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    const normalizeDocuments = (raw: string[]) =>
      raw
        .map((item) => this.cleanText(item))
        .filter((item) => item.length > 0);

    const priceRowsRu = normalizePriceRows(
      this.tryParseJson<FuelPriceRow[]>(
        row.priceRowsRuJson || row.priceRowsJson,
        [],
      ),
    );
    const priceRowsKz = normalizePriceRows(
      this.tryParseJson<FuelPriceRow[]>(
        row.priceRowsKzJson || row.priceRowsRuJson || row.priceRowsJson,
        [],
      ),
    );
    const priceRowsEn = normalizePriceRows(
      this.tryParseJson<FuelPriceRow[]>(
        row.priceRowsEnJson || row.priceRowsRuJson || row.priceRowsJson,
        [],
      ),
    );

    const documentsRu = normalizeDocuments(
      this.tryParseJson<string[]>(row.documentsRuJson || row.documentsJson, []),
    );
    const documentsKz = normalizeDocuments(
      this.tryParseJson<string[]>(
        row.documentsKzJson || row.documentsRuJson || row.documentsJson,
        [],
      ),
    );
    const documentsEn = normalizeDocuments(
      this.tryParseJson<string[]>(
        row.documentsEnJson || row.documentsRuJson || row.documentsJson,
        [],
      ),
    );

    return {
      capacityDate: row.capacityDate ?? '',
      capacityTons: row.capacityTons ?? '',
      priceRowsRu,
      priceRowsKz,
      priceRowsEn,
      priceRows: priceRowsRu,
      documentsRu,
      documentsKz,
      documentsEn,
      documents: documentsRu,
      submitEmail: row.submitEmail,
      contactPhone: row.contactPhone,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  private preparePayload(payload: Record<string, unknown>) {
    const typed = payload as FuelStorageUpdatePayload;

    const preparePriceRows = (input: unknown) => {
      const rows = Array.isArray(input) ? (input as FuelPriceRow[]) : [];
      return rows
        .map((item, index) => ({
          name: this.cleanText(item?.name),
          unit: this.cleanText(item?.unit),
          price: this.cleanText(item?.price),
          sortOrder: Number.isFinite(item?.sortOrder) ? Number(item.sortOrder) : index,
        }))
        .filter((item) => item.name && item.unit && item.price)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    };

    const prepareDocuments = (input: unknown) => {
      const rows = Array.isArray(input) ? (input as string[]) : [];
      return rows
        .map((item) => this.cleanText(item))
        .filter((item) => item.length > 0);
    };

    const fallbackPriceRows = preparePriceRows(typed.priceRows);
    const fallbackDocuments = prepareDocuments(typed.documents);

    const priceRowsRu = preparePriceRows(typed.priceRowsRu);
    const priceRowsKz = preparePriceRows(typed.priceRowsKz);
    const priceRowsEn = preparePriceRows(typed.priceRowsEn);

    const preparedPriceRowsRu = priceRowsRu.length ? priceRowsRu : fallbackPriceRows;
    const preparedPriceRowsKz = priceRowsKz.length ? priceRowsKz : fallbackPriceRows;
    const preparedPriceRowsEn = priceRowsEn.length ? priceRowsEn : fallbackPriceRows;

    if (
      preparedPriceRowsRu.length === 0 ||
      preparedPriceRowsKz.length === 0 ||
      preparedPriceRowsEn.length === 0
    ) {
      throw new BadRequestException('priceRowsRu/priceRowsKz/priceRowsEn must contain valid rows');
    }

    const documentsRu = prepareDocuments(typed.documentsRu);
    const documentsKz = prepareDocuments(typed.documentsKz);
    const documentsEn = prepareDocuments(typed.documentsEn);

    const preparedDocumentsRu = documentsRu.length ? documentsRu : fallbackDocuments;
    const preparedDocumentsKz = documentsKz.length ? documentsKz : fallbackDocuments;
    const preparedDocumentsEn = documentsEn.length ? documentsEn : fallbackDocuments;

    if (
      preparedDocumentsRu.length === 0 ||
      preparedDocumentsKz.length === 0 ||
      preparedDocumentsEn.length === 0
    ) {
      throw new BadRequestException('documentsRu/documentsKz/documentsEn must contain items');
    }

    const submitEmail = this.cleanText(typed.submitEmail);
    if (!submitEmail) {
      throw new BadRequestException('submitEmail is required');
    }

    const contactPhone = this.cleanText(typed.contactPhone);
    if (!contactPhone) {
      throw new BadRequestException('contactPhone is required');
    }

    return {
      capacityDate: this.cleanText(typed.capacityDate),
      capacityTons: this.cleanText(typed.capacityTons),
      priceRowsRu: preparedPriceRowsRu,
      priceRowsKz: preparedPriceRowsKz,
      priceRowsEn: preparedPriceRowsEn,
      documentsRu: preparedDocumentsRu,
      documentsKz: preparedDocumentsKz,
      documentsEn: preparedDocumentsEn,
      submitEmail,
      contactPhone,
    };
  }

  private cleanText(value: unknown, maxLength = 2000): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim().slice(0, maxLength);
  }

  private tryParseJson<T>(input: string, fallback: T): T {
    try {
      return JSON.parse(input) as T;
    } catch {
      return fallback;
    }
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS "fuel_storage_content" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "content_key" varchar(32) DEFAULT 'default' NOT NULL,
        "capacity_date" varchar(32),
        "capacity_tons" varchar(64),
        "price_rows_json" text DEFAULT '[]' NOT NULL,
        "price_rows_ru_json" text DEFAULT '[]' NOT NULL,
        "price_rows_kz_json" text DEFAULT '[]' NOT NULL,
        "price_rows_en_json" text DEFAULT '[]' NOT NULL,
        "documents_json" text DEFAULT '[]' NOT NULL,
        "documents_ru_json" text DEFAULT '[]' NOT NULL,
        "documents_kz_json" text DEFAULT '[]' NOT NULL,
        "documents_en_json" text DEFAULT '[]' NOT NULL,
        "submit_email" varchar(255) DEFAULT 'airportsemey@mail.kz' NOT NULL,
        "contact_phone" varchar(64) DEFAULT '8 (7222) 36-00-33' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "price_rows_ru_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "price_rows_kz_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "price_rows_en_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "documents_ru_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "documents_kz_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      ALTER TABLE "fuel_storage_content"
      ADD COLUMN IF NOT EXISTS "documents_en_json" text DEFAULT '[]' NOT NULL;
    `);
    await this.drizzle.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "fuel_storage_content_key_unique"
      ON "fuel_storage_content" ("content_key");
    `);

    await this.drizzle.db.execute(sql`
      INSERT INTO "fuel_storage_content" (
        "content_key",
        "capacity_date",
        "capacity_tons",
        "price_rows_json",
        "price_rows_ru_json",
        "price_rows_kz_json",
        "price_rows_en_json",
        "documents_json",
        "documents_ru_json",
        "documents_kz_json",
        "documents_en_json",
        "submit_email",
        "contact_phone"
      )
      VALUES (
        'default',
        '',
        '',
        ${JSON.stringify(DEFAULT_PRICE_ROWS_RU)},
        ${JSON.stringify(DEFAULT_PRICE_ROWS_RU)},
        ${JSON.stringify(DEFAULT_PRICE_ROWS_KZ)},
        ${JSON.stringify(DEFAULT_PRICE_ROWS_EN)},
        ${JSON.stringify(DEFAULT_DOCUMENTS_RU)},
        ${JSON.stringify(DEFAULT_DOCUMENTS_RU)},
        ${JSON.stringify(DEFAULT_DOCUMENTS_KZ)},
        ${JSON.stringify(DEFAULT_DOCUMENTS_EN)},
        'airportsemey@mail.kz',
        '8 (7222) 36-00-33'
      )
      ON CONFLICT ("content_key") DO NOTHING;
    `);
  }
}
