import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, lt } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { flights } from '../db/schema';
import { FlightsEventsService } from '../flights/flights.events';

class AviationStackRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('AviationStack rate limit reached');
  }
}

type ProviderFlight = {
  flightNumber: string;
  airlineName: string;
  airlineCode: string;
  direction: 'arrival' | 'departure';
  city: string;
  cityCode: string;
  terminal: string;
  gate: string | null;
  scheduledTime: Date;
  estimatedTime: Date | null;
  status:
    | 'scheduled'
    | 'checkin'
    | 'boarding'
    | 'departed'
    | 'delayed'
    | 'cancelled'
    | 'landing'
    | 'landed'
    | 'arrived';
};

const DEFAULT_ALLOWED_ROUTES: Array<{
  flightNumber: string;
  direction: 'arrival' | 'departure';
  city: string;
}> = [
  { flightNumber: 'KC7352', direction: 'departure', city: 'astana' },
  { flightNumber: 'KC7152', direction: 'departure', city: 'almaty' },
  { flightNumber: 'KC7154', direction: 'departure', city: 'almaty' },
  { flightNumber: 'IH3107', direction: 'departure', city: 'urzhar' },
  { flightNumber: 'DV754', direction: 'departure', city: 'karagandy' },
  { flightNumber: 'KC7351', direction: 'arrival', city: 'astana' },
  { flightNumber: 'KC7151', direction: 'arrival', city: 'almaty' },
  { flightNumber: 'KC7153', direction: 'arrival', city: 'almaty' },
  { flightNumber: 'IH3108', direction: 'arrival', city: 'urzhar' },
  { flightNumber: 'DV753', direction: 'arrival', city: 'karagandy' },
];

const WEEKLY_PLANNED: Record<
  string,
  {
    departures: Array<{ flightNumber: string; city: string; time: string }>;
    arrivals: Array<{ flightNumber: string; city: string; time: string }>;
  }
> = {
  mon: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:05' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
      { flightNumber: 'KC7154', city: 'Almaty', time: '20:55' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
      { flightNumber: 'KC7153', city: 'Almaty', time: '20:25' },
    ],
  },
  tue: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:05' },
      { flightNumber: 'IH3107', city: 'Urzhar', time: '11:10' },
      { flightNumber: 'DV754', city: 'Karagandy', time: '12:00' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'IH3108', city: 'Urzhar', time: '14:10' },
      { flightNumber: 'DV753', city: 'Karagandy', time: '11:00' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
    ],
  },
  wed: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:50' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
    ],
  },
  thu: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:05' },
      { flightNumber: 'IH3107', city: 'Urzhar', time: '11:30' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
      { flightNumber: 'KC7154', city: 'Almaty', time: '18:15' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'IH3108', city: 'Urzhar', time: '14:40' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
      { flightNumber: 'KC7153', city: 'Almaty', time: '17:40' },
    ],
  },
  fri: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:50' },
      { flightNumber: 'DV754', city: 'Karagandy', time: '12:00' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
      { flightNumber: 'KC7154', city: 'Almaty', time: '17:50' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'DV753', city: 'Karagandy', time: '11:00' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
      { flightNumber: 'KC7153', city: 'Almaty', time: '17:20' },
    ],
  },
  sat: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:05' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
    ],
  },
  sun: {
    departures: [
      { flightNumber: 'KC7352', city: 'Astana', time: '07:50' },
      { flightNumber: 'KC7152', city: 'Almaty', time: '13:25' },
    ],
    arrivals: [
      { flightNumber: 'KC7351', city: 'Astana', time: '06:35' },
      { flightNumber: 'KC7151', city: 'Almaty', time: '12:55' },
    ],
  },
};

const CITY_CODE_BY_NAME: Record<string, string> = {
  astana: 'NQZ',
  almaty: 'ALA',
  urzhar: 'UZR',
  karagandy: 'KGF',
};

const AIRLINE_NAME_BY_CODE: Record<string, string> = {
  KC: 'FlyArystan',
  DV: 'SCAT',
  IH: 'Hi Sky',
};

type AviationStackFlight = {
  flight_status?: string;
  airline?: {
    name?: string;
    iata?: string;
  };
  flight?: {
    iata?: string;
    icao?: string;
  };
  departure?: {
    airport?: string;
    iata?: string;
    scheduled?: string;
    estimated?: string;
    terminal?: string;
    gate?: string;
    delay?: number;
  };
  arrival?: {
    airport?: string;
    iata?: string;
    scheduled?: string;
    estimated?: string;
    terminal?: string;
    gate?: string;
    delay?: number;
  };
};

@Injectable()
export class FlightSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlightSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private inProgress = false;
  private rateLimitedUntilMs = 0;
  private syncCycleIndex = 0;
  private isStartupSync = true;
  private allowedRouteKeys = new Set<string>();
  private allowedFlightDirectionKeys = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly drizzle: DrizzleService,
    private readonly events: FlightsEventsService,
  ) {}

  onModuleInit() {
    const enabled = this.config.get<string>('FLIGHT_SYNC_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Flight sync disabled by FLIGHT_SYNC_ENABLED=false');
      return;
    }

    this.configureAllowedRoutes();

    const accessKey = this.config.get<string>('AVIATIONSTACK_ACCESS_KEY');
    if (!accessKey) {
      this.logger.warn(
        'AVIATIONSTACK_ACCESS_KEY is empty. Will seed today\'s planned flights only.',
      );
    }

    const intervalMs = Number(
      this.config.get<string>('FLIGHT_SYNC_INTERVAL_MS', '1800000'),
    );
    this.logger.log(
      `Flight sync enabled. Interval: ${intervalMs}ms (${Math.round(intervalMs / 60000)} min)`,
    );

    void this.runSync();
    this.timer = setInterval(() => {
      void this.runSync();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runSync() {
    if (this.inProgress) return;
    this.inProgress = true;

    let apiSource = 0;
    let apiFiltered = 0;
    let createdCount = 0;
    let updatedCount = 0;

    try {
      const removedCount = await this.removeDisallowedFlights();
      const prunedCount = await this.pruneStaleFlights();

      const accessKey = this.config.get<string>('AVIATIONSTACK_ACCESS_KEY');
      const canCallApi = Boolean(accessKey) && Date.now() >= this.rateLimitedUntilMs;

      if (canCallApi) {
        try {
          const airportIata = this.config.get<string>('FLIGHT_SYNC_AIRPORT_IATA', 'PLX').toUpperCase();
          const fetched = await this.fetchFromAviationStack(airportIata);
          apiSource = fetched.length;

          const filtered = fetched.filter(
            (item) => this.isAllowedRoute(item) && this.isToday(item.scheduledTime),
          );
          apiFiltered = filtered.length;

          for (const item of filtered) {
            const existing = await this.findExisting(item);
            if (!existing) {
              const [created] = await this.drizzle.db
                .insert(flights)
                .values({
                  flightNumber: item.flightNumber,
                  airlineName: item.airlineName,
                  airlineCode: item.airlineCode,
                  direction: item.direction,
                  city: item.city,
                  cityCode: item.cityCode,
                  terminal: item.terminal,
                  gate: item.gate,
                  sector: null,
                  scheduledTime: item.scheduledTime,
                  estimatedTime: item.estimatedTime,
                  status: item.status,
                })
                .returning();
              createdCount += 1;
              this.events.publish({ type: 'created', payload: created });
              continue;
            }

            if (this.wasManuallyManaged(existing)) continue;

            const shouldUpdate =
              existing.status !== item.status ||
              (existing.estimatedTime?.getTime() ?? 0) !== (item.estimatedTime?.getTime() ?? 0) ||
              (existing.gate ?? '') !== (item.gate ?? '') ||
              existing.airlineName !== item.airlineName ||
              existing.scheduledTime.getTime() !== item.scheduledTime.getTime();

            if (!shouldUpdate) continue;

            const [updated] = await this.drizzle.db
              .update(flights)
              .set({
                airlineName: item.airlineName,
                airlineCode: item.airlineCode,
                city: item.city,
                cityCode: item.cityCode,
                terminal: item.terminal,
                gate: item.gate,
                scheduledTime: item.scheduledTime,
                estimatedTime: item.estimatedTime,
                status: item.status,
                updatedAt: new Date(),
              })
              .where(eq(flights.id, existing.id))
              .returning();

            updatedCount += 1;
            this.events.publish({ type: 'updated', payload: updated });
          }
        } catch (error) {
          if (error instanceof AviationStackRateLimitError) {
            this.rateLimitedUntilMs = Date.now() + error.retryAfterMs;
            const retryAt = new Date(this.rateLimitedUntilMs).toISOString();
            this.logger.warn(
              `AviationStack rate limit. API paused until ${retryAt}. Planned seed will still run.`,
            );
          } else {
            throw error;
          }
        }
      } else if (this.rateLimitedUntilMs > Date.now()) {
        this.logger.debug('API sync skipped (rate limited). Seeding planned flights for today.');
      }

      const seededCount = await this.seedPlannedFlightsForToday();

      this.logger.log(
        `Flight sync done. api=${apiSource}, today=${apiFiltered}, created=${createdCount}, updated=${updatedCount}, seeded=${seededCount}, pruned=${prunedCount}, removed=${removedCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.logger.error(`Flight sync failed: ${message}`);
      try {
        const seededCount = await this.seedPlannedFlightsForToday();
        this.logger.log(`Planned fallback seed after error: ${seededCount} flights`);
      } catch (seedError) {
        const seedMessage = seedError instanceof Error ? seedError.message : 'Unknown seed error';
        this.logger.error(`Planned seed failed: ${seedMessage}`);
      }
    } finally {
      this.inProgress = false;
    }
  }

  private async fetchFromAviationStack(airportIata: string): Promise<ProviderFlight[]> {
    const accessKey = this.config.get<string>('AVIATIONSTACK_ACCESS_KEY');
    if (!accessKey) return [];

    const baseUrl = this.config.get<string>('AVIATIONSTACK_BASE_URL', 'http://api.aviationstack.com/v1');
    const fetchBoth =
      this.isStartupSync ||
      this.config.get<string>('FLIGHT_SYNC_FETCH_BOTH', 'false').toLowerCase() === 'true';

    if (this.isStartupSync) {
      this.logger.log('Startup sync: fetching arrivals and departures (one-time)');
      this.isStartupSync = false;
    }

    if (fetchBoth) {
      const [departures, arrivals] = await Promise.all([
        this.fetchAviationStackList(baseUrl, accessKey, 'dep_iata', airportIata),
        this.fetchAviationStackList(baseUrl, accessKey, 'arr_iata', airportIata),
      ]);

      const depMapped = departures
        .map((flight) => this.mapAviationStackFlight(flight, 'departure'))
        .filter((x): x is ProviderFlight => Boolean(x));
      const arrMapped = arrivals
        .map((flight) => this.mapAviationStackFlight(flight, 'arrival'))
        .filter((x): x is ProviderFlight => Boolean(x));

      return [...depMapped, ...arrMapped];
    }

    const fetchDepartures = this.syncCycleIndex % 2 === 0;
    this.syncCycleIndex += 1;

    const queryName = fetchDepartures ? 'dep_iata' : 'arr_iata';
    const direction = fetchDepartures ? 'departure' : 'arrival';
    const list = await this.fetchAviationStackList(baseUrl, accessKey, queryName, airportIata);

    this.logger.log(`Flight sync fetch: ${direction} only (saves API quota)`);

    return list
      .map((flight) => this.mapAviationStackFlight(flight, direction))
      .filter((x): x is ProviderFlight => Boolean(x));
  }

  private getRateLimitBackoffMs(response: Response, errorCode?: string): number {
    const retryAfterRaw = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : NaN;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    if (errorCode === 'usage_limit_reached') {
      return 24 * 60 * 60 * 1000;
    }

    return 6 * 60 * 60 * 1000;
  }

  private parseAviationStackError(payload: { error?: unknown }): string | undefined {
    if (!payload.error || typeof payload.error !== 'object') return undefined;
    const error = payload.error as { code?: string; message?: string; type?: string };
    return error.code ?? error.type;
  }

  private async fetchAviationStackList(
    baseUrl: string,
    accessKey: string,
    queryName: 'dep_iata' | 'arr_iata',
    airportIata: string,
  ): Promise<AviationStackFlight[]> {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/flights`);
    url.searchParams.set('access_key', accessKey);
    url.searchParams.set(queryName, airportIata);
    url.searchParams.set('limit', '100');

    const response = await fetch(url.toString());
    const payload = (await response.json()) as { data?: AviationStackFlight[]; error?: unknown };

    if (response.status === 429) {
      const errorCode = this.parseAviationStackError(payload);
      throw new AviationStackRateLimitError(this.getRateLimitBackoffMs(response, errorCode));
    }

    if (payload.error) {
      const errorCode = this.parseAviationStackError(payload);
      if (
        errorCode === 'rate_limit_reached' ||
        errorCode === 'usage_limit_reached' ||
        errorCode === 'function_access_restricted'
      ) {
        throw new AviationStackRateLimitError(this.getRateLimitBackoffMs(response, errorCode));
      }
      throw new Error(`AviationStack API error: ${JSON.stringify(payload.error)}`);
    }

    if (!response.ok) {
      throw new Error(`AviationStack request failed: HTTP ${response.status}`);
    }

    return Array.isArray(payload.data) ? payload.data : [];
  }

  private mapAviationStackFlight(
    item: AviationStackFlight,
    direction: 'arrival' | 'departure',
  ): ProviderFlight | null {
    const flightNumber = this.normalizeFlightNumber(item.flight?.iata || item.flight?.icao || '');
    if (!flightNumber) return null;

    const airlineName = (item.airline?.name || 'Unknown airline').trim();
    const airlineCode = (item.airline?.iata || flightNumber.slice(0, 2) || 'UN').toUpperCase();

    const scheduledRaw =
      direction === 'departure' ? item.departure?.scheduled : item.arrival?.scheduled;
    const estimatedRaw =
      direction === 'departure' ? item.departure?.estimated : item.arrival?.estimated;
    if (!scheduledRaw) return null;

    const scheduledTime = new Date(scheduledRaw);
    if (Number.isNaN(scheduledTime.getTime())) return null;

    const estimatedTime = estimatedRaw ? new Date(estimatedRaw) : null;
    const parsedEstimated =
      estimatedTime && !Number.isNaN(estimatedTime.getTime()) ? estimatedTime : null;

    const city = (
      direction === 'departure' ? item.arrival?.airport : item.departure?.airport
    )?.trim() || 'Unknown city';
    const cityCode =
      (direction === 'departure' ? item.arrival?.iata : item.departure?.iata)?.toUpperCase() || 'UNK';

    const terminal =
      (
        direction === 'departure' ? item.departure?.terminal : item.arrival?.terminal
      )?.trim() || '1';
    const gate = (direction === 'departure' ? item.departure?.gate : item.arrival?.gate)?.trim() || null;

    const status = this.mapStatus(item.flight_status, direction, item);

    return {
      flightNumber,
      airlineName,
      airlineCode: airlineCode.slice(0, 8),
      direction,
      city,
      cityCode: cityCode.slice(0, 8),
      terminal,
      gate,
      scheduledTime,
      estimatedTime: parsedEstimated,
      status,
    };
  }

  private mapStatus(
    status: string | undefined,
    direction: 'arrival' | 'departure',
    item: AviationStackFlight,
  ): ProviderFlight['status'] {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'landed') return direction === 'arrival' ? 'landed' : 'arrived';
    if (normalized === 'active') return direction === 'departure' ? 'departed' : 'landing';
    if (normalized === 'incident' || normalized === 'diverted') return 'delayed';

    const delay = Math.max(item.departure?.delay ?? 0, item.arrival?.delay ?? 0);
    if (delay > 0) return 'delayed';
    return 'scheduled';
  }

  private async findExisting(item: ProviderFlight) {
    const candidates = await this.drizzle.db
      .select()
      .from(flights)
      .where(
        and(
          eq(flights.flightNumber, item.flightNumber),
          eq(flights.direction, item.direction),
        ),
      )
      .orderBy(desc(flights.updatedAt))
      .limit(30);

    const sameDay = candidates.find((flight) =>
      this.isSameCalendarDay(flight.scheduledTime, item.scheduledTime),
    );
    if (sameDay) return sameDay;

    if (this.isToday(item.scheduledTime)) {
      const todayMatch = candidates.find((flight) => this.isToday(flight.scheduledTime));
      if (todayMatch) return todayMatch;
    }

    return (
      candidates.find((flight) => {
        const diffMs = Math.abs(flight.scheduledTime.getTime() - item.scheduledTime.getTime());
        return diffMs <= 60 * 60 * 1000;
      }) ?? null
    );
  }

  private configureAllowedRoutes() {
    const envValue = this.config.get<string>('FLIGHT_SYNC_ALLOWED_ROUTES', '').trim();
    const source = envValue
      ? envValue
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((entry) => {
            const [flightNumber, direction, city] = entry.split(':').map((x) => x.trim());
            if (!flightNumber || !city || (direction !== 'arrival' && direction !== 'departure')) {
              return null;
            }
            return { flightNumber, direction, city } as const;
          })
          .filter((x): x is { flightNumber: string; direction: 'arrival' | 'departure'; city: string } =>
            Boolean(x),
          )
      : DEFAULT_ALLOWED_ROUTES;

    this.allowedRouteKeys.clear();
    this.allowedFlightDirectionKeys.clear();

    for (const route of source) {
      const flightNumber = this.normalizeFlightNumber(route.flightNumber);
      const city = this.normalizeCity(route.city);
      this.allowedRouteKeys.add(`${flightNumber}|${route.direction}|${city}`);
      this.allowedFlightDirectionKeys.add(`${flightNumber}|${route.direction}`);
    }

    this.logger.log(`Allowed routes configured: ${this.allowedRouteKeys.size}`);
  }

  private wasManuallyManaged(row: { createdAt: Date; updatedAt: Date | null }): boolean {
    const created = row.createdAt.getTime();
    const updated = row.updatedAt?.getTime() ?? created;
    return updated - created > 15_000;
  }

  private isAllowedRoute(item: ProviderFlight): boolean {
    if (item.airlineCode?.trim().toUpperCase() === 'IH') {
      return true;
    }

    const routeKey = `${this.normalizeFlightNumber(item.flightNumber)}|${item.direction}|${this.normalizeCity(item.city)}`;
    if (this.allowedRouteKeys.has(routeKey)) {
      return true;
    }
    // Fallback to flight+direction in case provider city naming differs
    const flightDirectionKey = `${this.normalizeFlightNumber(item.flightNumber)}|${item.direction}`;
    return this.allowedFlightDirectionKeys.has(flightDirectionKey);
  }

  private async removeDisallowedFlights(): Promise<number> {
    const existing = await this.drizzle.db.select().from(flights);
    let removed = 0;

    for (const row of existing) {
      const keep = this.isAllowedRoute({
        flightNumber: row.flightNumber,
        airlineName: row.airlineName,
        airlineCode: row.airlineCode,
        direction: row.direction,
        city: row.city,
        cityCode: row.cityCode,
        terminal: row.terminal,
        gate: row.gate ?? null,
        scheduledTime: row.scheduledTime,
        estimatedTime: row.estimatedTime,
        status: row.status,
      });

      if (keep) continue;

      await this.drizzle.db.delete(flights).where(eq(flights.id, row.id));
      this.events.publish({ type: 'deleted', payload: { id: row.id } });
      removed += 1;
    }

    return removed;
  }

  private async pruneStaleFlights(): Promise<number> {
    const startOfToday = this.getStartOfToday();
    const stale = await this.drizzle.db
      .select()
      .from(flights)
      .where(lt(flights.scheduledTime, startOfToday));

    let removed = 0;
    for (const row of stale) {
      await this.drizzle.db.delete(flights).where(eq(flights.id, row.id));
      this.events.publish({ type: 'deleted', payload: { id: row.id } });
      removed += 1;
    }

    return removed;
  }

  private getStartOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private isSameCalendarDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private isToday(date: Date): boolean {
    return this.isSameCalendarDay(date, new Date());
  }

  private mapPlannedStatus(
    direction: 'arrival' | 'departure',
    scheduledTime: Date,
  ): ProviderFlight['status'] {
    if (scheduledTime.getTime() > Date.now()) return 'scheduled';
    return direction === 'departure' ? 'departed' : 'landed';
  }

  private normalizeFlightNumber(value: string): string {
    return value.replace(/\s+/g, '').trim().toUpperCase();
  }

  private normalizeCity(value: string): string {
    const raw = value.toLowerCase().trim();
    const map: Record<string, string> = {
      astana: 'astana',
      'nur-sultan': 'astana',
      алматы: 'almaty',
      almaty: 'almaty',
      urzhar: 'urzhar',
      үржар: 'urzhar',
      урджар: 'urzhar',
      karagandy: 'karagandy',
      karaganda: 'karagandy',
      караганда: 'karagandy',
      астана: 'astana',
    };
    return map[raw] ?? raw;
  }

  private getDayKey(date: Date): keyof typeof WEEKLY_PLANNED {
    const idx = date.getDay();
    const map: Record<number, keyof typeof WEEKLY_PLANNED> = {
      0: 'sun',
      1: 'mon',
      2: 'tue',
      3: 'wed',
      4: 'thu',
      5: 'fri',
      6: 'sat',
    };
    return map[idx];
  }

  private makeTodayAt(time: string): Date {
    const [hh, mm] = time.split(':').map((x) => Number(x));
    const now = new Date();
    now.setHours(hh || 0, mm || 0, 0, 0);
    return now;
  }

  private async seedPlannedFlightsForToday(): Promise<number> {
    const seedEnabled =
      this.config.get<string>('FLIGHT_SYNC_SEED_PLANNED', 'true').toLowerCase() !== 'false';
    if (!seedEnabled) return 0;

    const dayKey = this.getDayKey(new Date());
    const plan = WEEKLY_PLANNED[dayKey];
    if (!plan) return 0;

    const expected: ProviderFlight[] = [
      ...plan.departures.map((item) => this.mapPlanned(item, 'departure')),
      ...plan.arrivals.map((item) => this.mapPlanned(item, 'arrival')),
    ];

    let seeded = 0;

    for (const item of expected) {
      await this.removePastInstances(item.flightNumber, item.direction);

      const existing = await this.findExisting(item);
      if (existing) {
        if (this.wasManuallyManaged(existing)) {
          continue;
        }

        const shouldRefresh =
          !this.isToday(existing.scheduledTime) ||
          (existing.estimatedTime === null &&
            existing.status === 'scheduled' &&
            item.scheduledTime.getTime() <= Date.now());

        if (shouldRefresh && existing.estimatedTime === null && existing.gate === null) {
          const [updated] = await this.drizzle.db
            .update(flights)
            .set({
              scheduledTime: item.scheduledTime,
              status: this.mapPlannedStatus(item.direction, item.scheduledTime),
              updatedAt: new Date(),
            })
            .where(eq(flights.id, existing.id))
            .returning();
          this.events.publish({ type: 'updated', payload: updated });
        }
        continue;
      }

      const [created] = await this.drizzle.db
        .insert(flights)
        .values({
          flightNumber: item.flightNumber,
          airlineName: item.airlineName,
          airlineCode: item.airlineCode,
          direction: item.direction,
          city: item.city,
          cityCode: item.cityCode,
          terminal: item.terminal,
          gate: item.gate,
          sector: null,
          scheduledTime: item.scheduledTime,
          estimatedTime: item.estimatedTime,
          status: this.mapPlannedStatus(item.direction, item.scheduledTime),
        })
        .returning();

      this.events.publish({ type: 'created', payload: created });
      seeded += 1;
    }

    return seeded;
  }

  private async removePastInstances(flightNumber: string, direction: 'arrival' | 'departure') {
    const startOfToday = this.getStartOfToday();
    const rows = await this.drizzle.db
      .select()
      .from(flights)
      .where(and(eq(flights.flightNumber, flightNumber), eq(flights.direction, direction)));

    for (const row of rows) {
      if (row.scheduledTime >= startOfToday) continue;
      await this.drizzle.db.delete(flights).where(eq(flights.id, row.id));
      this.events.publish({ type: 'deleted', payload: { id: row.id } });
    }
  }

  private mapPlanned(
    item: { flightNumber: string; city: string; time: string },
    direction: 'arrival' | 'departure',
  ): ProviderFlight {
    const flightNumber = this.normalizeFlightNumber(item.flightNumber);
    const airlineCode = flightNumber.slice(0, 2).toUpperCase();
    const normalizedCity = this.normalizeCity(item.city);
    const cityCode = CITY_CODE_BY_NAME[normalizedCity] ?? 'UNK';
    const scheduledTime = this.makeTodayAt(item.time);

    return {
      flightNumber,
      airlineName: AIRLINE_NAME_BY_CODE[airlineCode] ?? 'Unknown airline',
      airlineCode,
      direction,
      city: item.city,
      cityCode,
      terminal: '1',
      gate: null,
      scheduledTime,
      estimatedTime: null,
      status: this.mapPlannedStatus(direction, scheduledTime),
    };
  }
}
