import { BadRequestException } from '@nestjs/common';
import { normalizeScheduleEntry, ScheduleEntry } from './schedule-entry';

const DAYS: Array<[RegExp, number]> = [
  [/понедельник|monday/i, 1], [/вторник|tuesday/i, 2], [/среда|wednesday/i, 3],
  [/четверг|thursday/i, 4], [/пятница|friday/i, 5], [/суббота|saturday/i, 6], [/воскресенье|sunday/i, 0],
];
const CITY_NAMES: Array<[RegExp, string]> = [
  [/астана|astana/i, 'Astana'], [/алматы|almaty/i, 'Almaty'],
  [/урджар|уржар|үржар|urzhar/i, 'Urzhar'], [/караганда|қарағанды|karagand/i, 'Karagandy'],
];

function dateRange(line: string) {
  const match = /(\d{2})[./](\d{2})[./](\d{4}|\d{2})\s*[-–—]\s*(\d{2})[./](\d{2})[./](\d{4}|\d{2})/.exec(line);
  if (!match) return null;
  const iso = (day: string, month: string, year: string) => `${year.length === 2 ? '20' + year : year}-${month}-${day}`;
  return { validFrom: iso(match[1], match[2], match[3]), validTo: iso(match[4], match[5], match[6]) };
}

function flightNumber(value: string) {
  const lookalikes: Record<string, string> = { І: 'I', Н: 'H', К: 'K', С: 'C', О: 'O', Р: 'P', А: 'A', В: 'B', $: 'S' };
  return value.toUpperCase().replace(/\s/g, '').replace(/[ІНКСОРАВ$]/g, (char) => lookalikes[char]).replace(/^[1I][0OQ]/, 'IQ').replace(/^1H/, 'IH').replace(/^F5/, 'FS');
}

/** The airport's paper table has two flight numbers and four times per row. */
export function parseScheduleText(text: string): { entries: ScheduleEntry[]; warnings: string[] } {
  const entries: ScheduleEntry[] = [];
  const warnings: string[] = [];
  let weekday: number | null = null;
  let commonPeriod: ReturnType<typeof dateRange> = null;
  const daysSeen = new Set<number>();

  for (const original of text.split(/\r?\n/)) {
    const line = original.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const day = DAYS.find(([pattern]) => pattern.test(line));
    if (day) { weekday = day[1]; daysSeen.add(weekday); continue; }
    if (weekday === null) { commonPeriod = dateRange(line) ?? commonPeriod; continue; }
    const flights = [...line.matchAll(/(?<![\p{L}\p{N}])[A-ZА-ЯІ$0-9]{2}\s*\d{3,4}(?!\d)/giu)];
    const city = CITY_NAMES.find(([pattern]) => pattern.test(line))?.[1];
    if (!city && flights.length === 0) continue;
    const times = [...line.matchAll(/\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b/g)].map((match) => `${match[1].padStart(2, '0')}:${match[2]}`);
    const period = dateRange(line) ?? commonPeriod;
    if (!city || flights.length !== 2 || times.length !== 4 || !period) {
      warnings.push(`Не удалось полностью прочитать строку: ${line}`);
      continue;
    }
    try {
      const outbound = normalizeScheduleEntry({ weekday, city, direction: 'departure', flightNumber: flightNumber(flights[0][0]), time: times[0], counterpartTime: times[1], ...period });
      const inbound = normalizeScheduleEntry({ weekday, city, direction: 'arrival', flightNumber: flightNumber(flights[1][0]), time: times[3], counterpartTime: times[2], ...period });
      entries.push(outbound, inbound);
    } catch {
      warnings.push(`Проверьте номер, время и период: ${line}`);
    }
  }
  if (!entries.length) throw new BadRequestException('Не удалось распознать таблицу. Загрузите чёткое фото целиком с днями недели, номерами рейсов и временем. Расписание не изменено.');
  if (daysSeen.size < 7) warnings.push('Распознаны не все семь дней недели. Проверьте полноту расписания перед сохранением.');
  const unique = new Map(entries.map((entry) => [`${entry.weekday}|${entry.direction}|${entry.flightNumber}|${entry.time}|${entry.validFrom}|${entry.validTo}`, entry]));
  if (unique.size !== entries.length) warnings.push('Повторяющиеся строки объединены. Проверьте таблицу.');
  return { entries: [...unique.values()], warnings };
}
