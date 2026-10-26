import { DEFAULT_SCHEDULE_ENTRIES } from './default-schedule';
import { ScheduleEntry } from './schedule-entry';

type StoredEntry = ScheduleEntry & { id?: string | null };

const CITY_KEYS: Record<string, string> = { astana: 'astana', астана: 'astana', almaty: 'almaty', алматы: 'almaty', urzhar: 'urzhar', урджар: 'urzhar', үржар: 'urzhar' };

function slotKey(entry: ScheduleEntry) {
  const city = String(entry.city || '').trim().toLowerCase();
  let number = String(entry.flightNumber || '').replace(/\s/g, '').toUpperCase();
  if (entry.direction === 'arrival' && number === 'FS7153'
    && ((Number(entry.weekday) === 1 && entry.time === '18:35') || (Number(entry.weekday) === 5 && entry.time === '19:40'))) number = 'FS7151';
  return `${Number(entry.weekday)}|${entry.direction}|${number}|${CITY_KEYS[city] || city}|${entry.time}`;
}

/** Upgrade only the complete, known legacy winter plan; preserve custom plans. */
export function upgradeLegacyWinterSchedule(entries: StoredEntry[]): StoredEntry[] | null {
  if (entries.length !== DEFAULT_SCHEDULE_ENTRIES.length
    || entries.some((entry) => entry.counterpartTime || entry.validFrom || entry.validTo)) return null;
  const defaults = new Map(DEFAULT_SCHEDULE_ENTRIES.map((entry) => [slotKey(entry), entry]));
  const seen = new Map<string, StoredEntry[]>();
  const upgraded: StoredEntry[] = [];
  for (const entry of entries) {
    const key = slotKey(entry);
    const known = defaults.get(key);
    if (!known) return null;
    seen.set(key, [...(seen.get(key) || []), entry]);
    upgraded.push({ ...entry, flightNumber: known.flightNumber, counterpartTime: known.counterpartTime, validFrom: known.validFrom, validTo: known.validTo });
  }
  const duplicates = [...seen].filter(([, rows]) => rows.length > 1);
  const missing = DEFAULT_SCHEDULE_ENTRIES.filter((entry) => !seen.has(slotKey(entry)));
  if (!duplicates.length && !missing.length) return upgraded;

  // The deployed old plan also contains a second Saturday IQ pair in place of
  // the two extra Friday flights. Repair this exact known legacy variant only.
  const saturday = new Set(DEFAULT_SCHEDULE_ENTRIES.filter((entry) => entry.weekday === 6 && entry.flightNumber.startsWith('IQ')).map(slotKey));
  if (duplicates.length !== 2 || duplicates.some(([key, rows]) => !saturday.has(key) || rows.length !== 2)
    || missing.length !== 2 || missing.some((entry) => entry.weekday !== 5 || entry.validFrom !== '2026-11-06')) return null;
  return DEFAULT_SCHEDULE_ENTRIES.map((known) => ({
    ...known,
    ...(seen.get(slotKey(known))?.[0] || {}),
    flightNumber: known.flightNumber,
    counterpartTime: known.counterpartTime,
    validFrom: known.validFrom,
    validTo: known.validTo,
  }));
}
