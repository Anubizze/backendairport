import { BadRequestException } from '@nestjs/common';

export type ScheduleEntry = {
  weekday: number;
  flightNumber: string;
  direction: 'arrival' | 'departure';
  city: string;
  time: string;
  counterpartTime?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

export function normalizeScheduleEntry(value: unknown): ScheduleEntry {
  if (!value || typeof value !== 'object') throw new BadRequestException('Некорректная строка расписания');
  const entry = value as Record<string, unknown>;
  const weekday = Number(entry.weekday);
  const flightNumber = String(entry.flightNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const city = String(entry.city ?? '').trim();
  const time = String(entry.time ?? '').trim();
  const counterpartTime = String(entry.counterpartTime ?? '').trim() || null;
  const validFrom = String(entry.validFrom ?? '').trim() || null;
  const validTo = String(entry.validTo ?? '').trim() || null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new BadRequestException('Некорректный день недели');
  if (!/^[A-Z0-9]{2}\d{3,4}$/.test(flightNumber) || !/[A-Z]/.test(flightNumber.slice(0, 2))) throw new BadRequestException('Укажите корректный номер рейса');
  if (!city || city.length > 120) throw new BadRequestException('Укажите город (до 120 символов)');
  if (entry.direction !== 'arrival' && entry.direction !== 'departure') throw new BadRequestException('Некорректное направление рейса');
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(time) || (counterpartTime && !timePattern.test(counterpartTime))) {
    throw new BadRequestException(`Некорректное время у рейса ${flightNumber}`);
  }
  for (const date of [validFrom, validTo]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      throw new BadRequestException(`Некорректная дата у рейса ${flightNumber}`);
    }
  }
  if (validFrom && validTo && validFrom > validTo) throw new BadRequestException(`Начало периода позже окончания у рейса ${flightNumber}`);
  return { weekday, flightNumber, direction: entry.direction, city, time, counterpartTime, validFrom, validTo };
}
