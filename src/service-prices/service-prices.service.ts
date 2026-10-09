import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { servicePriceContent } from '../db/schema';

type TariffRow = {
  nameRu: string;
  unitRu: string;
  priceRu: string;
  nameKz: string;
  unitKz: string;
  priceKz: string;
  nameEn: string;
  unitEn: string;
  priceEn: string;
};

export type ServicePrices = {
  vipOne: string;
  vipFew: string;
  vipGroup: string;
  luggage: string;
  tariffs: TariffRow[];
};

const DEFAULT_PRICES: ServicePrices = {
  vipOne: '5 000 тг',
  vipFew: '4 000 тг',
  vipGroup: 'от 3 000 тг/чел',
  luggage: '1 000 тенге/сутки',
  tariffs: [
    {
      nameRu: 'Обслуживание пассажирских рейсов',
      unitRu: 'за рейс',
      priceRu: 'По договору с авиакомпанией',
      nameKz: 'Жолаушы рейстерін обслуживеу',
      unitKz: 'рейс бойынша',
      priceKz: 'Авиакомпаниямен келісім бойынша',
      nameEn: 'Passenger flight handling',
      unitEn: 'per flight',
      priceEn: 'Per airline agreement',
    },
    {
      nameRu: 'Парковка ВС (стоянка)',
      unitRu: 'за час',
      priceRu: 'По заявке оператора',
      nameKz: 'ҰША тұрағы (стоянка)',
      unitKz: 'сағат бойынша',
      priceKz: 'Оператор өтінімі бойынша',
      nameEn: 'Aircraft parking (ramp)',
      unitEn: 'per hour',
      priceEn: 'Upon operator request',
    },
    {
      nameRu: 'VIP/CIP зал',
      unitRu: 'за пассажира',
      priceRu: 'От 3 000 тг',
      nameKz: 'VIP/CIP залы',
      unitKz: 'жолаушыға',
      priceKz: '3 000 тг-ден',
      nameEn: 'VIP/CIP lounge',
      unitEn: 'per passenger',
      priceEn: 'From 3,000 KZT',
    },
    {
      nameRu: 'Камера хранения',
      unitRu: 'за сутки',
      priceRu: 'По прайсу аэропорта',
      nameKz: 'Заттарды сақтау бөлмесі',
      unitKz: 'тәулігіне',
      priceKz: 'Әуежай прайсы бойынша',
      nameEn: 'Left luggage',
      unitEn: 'per day',
      priceEn: 'Per airport price list',
    },
    {
      nameRu: 'Коммерческая аренда',
      unitRu: 'за м²',
      priceRu: 'Индивидуально',
      nameKz: 'Коммерциялық жалға алу',
      unitKz: 'м² бойынша',
      priceKz: 'Жеке',
      nameEn: 'Commercial rental',
      unitEn: 'per m²',
      priceEn: 'Individual',
    },
  ],
};

@Injectable()
export class ServicePricesService implements OnModuleInit {
  constructor(private readonly drizzle: DrizzleService) {}

  async onModuleInit() {
    await this.ensureStorage();
  }

  async get(): Promise<ServicePrices> {
    await this.ensureStorage();
    const [row] = await this.drizzle.db
      .select()
      .from(servicePriceContent)
      .where(eq(servicePriceContent.id, 1))
      .limit(1);
    if (!row?.payload) return DEFAULT_PRICES;
    return this.normalize(this.parse(row.payload));
  }

  async update(body: unknown): Promise<ServicePrices> {
    await this.ensureStorage();
    const prices = this.normalize(body);
    if (!prices.vipOne || !prices.luggage) {
      throw new BadRequestException('Укажите цены VIP и камеры хранения');
    }
    const payload = JSON.stringify(prices);
    await this.drizzle.db
      .insert(servicePriceContent)
      .values({ id: 1, payload, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: servicePriceContent.id,
        set: { payload, updatedAt: new Date() },
      });
    return prices;
  }

  private parse(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      return DEFAULT_PRICES;
    }
  }

  private normalize(body: unknown): ServicePrices {
    const source = body && typeof body === 'object' ? (body as Partial<ServicePrices>) : {};
    const tariffs = Array.isArray(source.tariffs) ? source.tariffs : DEFAULT_PRICES.tariffs;
    return {
      vipOne: this.text(source.vipOne, DEFAULT_PRICES.vipOne),
      vipFew: this.text(source.vipFew, DEFAULT_PRICES.vipFew),
      vipGroup: this.text(source.vipGroup, DEFAULT_PRICES.vipGroup),
      luggage: this.text(source.luggage, DEFAULT_PRICES.luggage),
      tariffs: tariffs
        .map((row) => this.normalizeTariff(row))
        .filter((row) => row.nameRu || row.nameKz || row.nameEn),
    };
  }

  private normalizeTariff(row: unknown): TariffRow {
    const item = row && typeof row === 'object' ? (row as Partial<TariffRow>) : {};
    return {
      nameRu: this.text(item.nameRu, ''),
      unitRu: this.text(item.unitRu, ''),
      priceRu: this.text(item.priceRu, ''),
      nameKz: this.text(item.nameKz, ''),
      unitKz: this.text(item.unitKz, ''),
      priceKz: this.text(item.priceKz, ''),
      nameEn: this.text(item.nameEn, ''),
      unitEn: this.text(item.unitEn, ''),
      priceEn: this.text(item.priceEn, ''),
    };
  }

  private text(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, 180);
    return trimmed || fallback;
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_price_content (
        id integer PRIMARY KEY,
        payload text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }
}
