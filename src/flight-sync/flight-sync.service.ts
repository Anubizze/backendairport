import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { flightScheduleEntries, flights, scheduleBoard } from '../db/schema';
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

type PlannedSlot = {
  flightNumber: string;
  city: string;
  time: string;
  validFrom?: string;
  validTo?: string;
};

const DEFAULT_ALLOWED_ROUTES: Array<{
  flightNumber: string;
  direction: 'arrival' | 'departure';
  city: string;
}> = [
  { flightNumber: 'IQ374', direction: 'departure', city: 'astana' },
  { flightNumber: 'FS7152', direction: 'departure', city: 'almaty' },
  { flightNumber: 'FS7352', direction: 'departure', city: 'astana' },
  { flightNumber: 'IH3107', direction: 'departure', city: 'urzhar' },
  { flightNumber: 'KC7154', direction: 'departure', city: 'almaty' },
  { flightNumber: 'FS7154', direction: 'departure', city: 'almaty' },
  { flightNumber: 'IQ373', direction: 'arrival', city: 'astana' },
  { flightNumber: 'FS7151', direction: 'arrival', city: 'almaty' },
  { flightNumber: 'FS7351', direction: 'arrival', city: 'astana' },
  { flightNumber: 'IH3108', direction: 'arrival', city: 'urzhar' },
  { flightNumber: 'KC7153', direction: 'arrival', city: 'almaty' },
  { flightNumber: 'FS7153', direction: 'arrival', city: 'almaty' },
];

const WEEKLY_PLANNED: Record<
  string,
  {
    departures: PlannedSlot[];
    arrivals: PlannedSlot[];
  }
> = {
  mon: {
    departures: [
      { flightNumber: 'IQ374', city: 'Astana', time: '09:45', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
    arrivals: [
      { flightNumber: 'IQ373', city: 'Astana', time: '09:20', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
  },
  tue: {
    departures: [
      { flightNumber: 'IH3107', city: 'Urzhar', time: '09:10', validFrom: '2026-06-01', validTo: '2026-10-31' },
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
      { flightNumber: 'KC7154', city: 'Almaty', time: '17:55', validFrom: '2026-10-06', validTo: '2026-10-20' },
    ],
    arrivals: [
      { flightNumber: 'IH3108', city: 'Urzhar', time: '12:20', validFrom: '2026-06-01', validTo: '2026-10-31' },
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
      { flightNumber: 'KC7153', city: 'Almaty', time: '17:25', validFrom: '2026-10-06', validTo: '2026-10-20' },
    ],
  },
  wed: {
    departures: [
      { flightNumber: 'IQ374', city: 'Astana', time: '09:45', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
    arrivals: [
      { flightNumber: 'IQ373', city: 'Astana', time: '09:20', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
  },
  thu: {
    departures: [
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
    arrivals: [
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
  },
  fri: {
    departures: [
      { flightNumber: 'IH3107', city: 'Urzhar', time: '09:10', validFrom: '2026-06-12', validTo: '2026-10-31' },
      { flightNumber: 'IQ374', city: 'Astana', time: '09:45', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
      { flightNumber: 'FS7154', city: 'Almaty', time: '17:50', validFrom: '2026-04-03', validTo: '2026-10-23' },
    ],
    arrivals: [
      { flightNumber: 'IQ373', city: 'Astana', time: '09:20', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'IH3108', city: 'Urzhar', time: '12:20', validFrom: '2026-06-12', validTo: '2026-10-31' },
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
      { flightNumber: 'FS7153', city: 'Almaty', time: '17:20', validFrom: '2026-04-03', validTo: '2026-10-23' },
    ],
  },
  sat: {
    departures: [
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
    arrivals: [
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
  },
  sun: {
    departures: [
      { flightNumber: 'IQ374', city: 'Astana', time: '09:45', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7152', city: 'Almaty', time: '13:35', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7352', city: 'Astana', time: '16:20', validFrom: '2026-06-01', validTo: '2026-10-25' },
    ],
    arrivals: [
      { flightNumber: 'IQ373', city: 'Astana', time: '09:20', validFrom: '2026-08-03', validTo: '2026-10-24' },
      { flightNumber: 'FS7151', city: 'Almaty', time: '13:05', validFrom: '2026-03-29', validTo: '2026-10-25' },
      { flightNumber: 'FS7351', city: 'Astana', time: '15:50', validFrom: '2026-06-01', validTo: '2026-10-25' },
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
  FS: 'FlyArystan',
  KC: 'FlyArystan',
  IQ: 'Vietjet Qazaqstan',
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

  async onModuleInit() {
    await this.ensureScheduleStorage();

    const enabled = this.config.get<string>('FLIGHT_SYNC_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('Flight sync disabled by FLIGHT_SYNC_ENABLED=false');
      return;
    }

    await this.reloadAllowedRoutes();

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
            (item) =>
              this.isToday(item.scheduledTime) &&
              Boolean(this.findPlannedToday(item.flightNumber, item.direction)),
          );
          apiFiltered = filtered.length;

          for (const rawItem of filtered) {
            const item = this.withOfficialPlan(rawItem);
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
                  scheduleLocked: true,
                })
                .returning();
              createdCount += 1;
              this.events.publish({ type: 'created', payload: created });
              continue;
            }

            if (existing.scheduleLocked || this.wasManuallyManaged(existing)) {
              const liveChanged =
                existing.status !== item.status ||
                (existing.estimatedTime?.getTime() ?? 0) !== (item.estimatedTime?.getTime() ?? 0) ||
                (existing.gate ?? '') !== (item.gate ?? '');

              if (!liveChanged) continue;

              const [updated] = await this.drizzle.db
                .update(flights)
                .set({
                  gate: item.gate,
                  estimatedTime: item.estimatedTime,
                  status: item.status,
                  updatedAt: new Date(),
                })
                .where(eq(flights.id, existing.id))
                .returning();

              updatedCount += 1;
              this.events.publish({ type: 'updated', payload: updated });
              continue;
            }

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

      return this.dedupeProviderFlights([...depMapped, ...arrMapped]);
    }

    const fetchDepartures = this.syncCycleIndex % 2 === 0;
    this.syncCycleIndex += 1;

    const queryName = fetchDepartures ? 'dep_iata' : 'arr_iata';
    const direction = fetchDepartures ? 'departure' : 'arrival';
    const list = await this.fetchAviationStackList(baseUrl, accessKey, queryName, airportIata);

    this.logger.log(`Flight sync fetch: ${direction} only (saves API quota)`);

    return this.dedupeProviderFlights(
      list
        .map((flight) => this.mapAviationStackFlight(flight, direction))
        .filter((x): x is ProviderFlight => Boolean(x)),
    );
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

    const scheduledTime = this.parseAirportLocalTime(scheduledRaw);
    if (!scheduledTime) return null;

    const estimatedTime = this.parseAirportLocalTime(estimatedRaw);
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
      if (row.scheduleLocked || this.findPlannedToday(row.flightNumber, row.direction)) continue;

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

  private airportNowParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Almaty',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      weekday: get('weekday'),
    };
  }

  private airportWeekday(date = new Date()): number {
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[this.airportNowParts(date).weekday] ?? 0;
  }

  private getStartOfToday(): Date {
    const { year, month, day } = this.airportNowParts();
    return new Date(`${year}-${month}-${day}T00:00:00+05:00`);
  }

  private isSameCalendarDay(a: Date, b: Date): boolean {
    const left = this.airportNowParts(a);
    const right = this.airportNowParts(b);
    return left.year === right.year && left.month === right.month && left.day === right.day;
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
    const idx = this.airportWeekday(date);
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

  private airportDateKey(date = new Date()): string {
    const { year, month, day } = this.airportNowParts(date);
    return `${year}-${month}-${day}`;
  }

  private isPlanValidToday(item: { validFrom?: string; validTo?: string }): boolean {
    const today = this.airportDateKey();
    if (item.validFrom && today < item.validFrom) return false;
    if (item.validTo && today > item.validTo) return false;
    return true;
  }

  private findPlannedToday(flightNumber: string, direction: 'arrival' | 'departure') {
    const plan = WEEKLY_PLANNED[this.getDayKey(new Date())];
    if (!plan) return null;
    const list = direction === 'departure' ? plan.departures : plan.arrivals;
    const number = this.normalizeFlightNumber(flightNumber);
    return (
      list.find(
        (row) =>
          this.normalizeFlightNumber(row.flightNumber) === number && this.isPlanValidToday(row),
      ) ?? null
    );
  }

  private withOfficialPlan(item: ProviderFlight): ProviderFlight {
    const planned = this.findPlannedToday(item.flightNumber, item.direction);
    if (!planned) return item;
    const official = this.mapPlanned(planned, item.direction);
    return {
      ...item,
      airlineName: official.airlineName,
      airlineCode: official.airlineCode,
      city: official.city,
      cityCode: official.cityCode,
      scheduledTime: official.scheduledTime,
    };
  }

  private parseAirportLocalTime(raw: string | undefined): Date | null {
    if (!raw) return null;
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    if (!match) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const [, day, hh, mm, ss] = match;
    return new Date(`${day}T${hh}:${mm}:${ss ?? '00'}+05:00`);
  }

  private dedupeProviderFlights(items: ProviderFlight[]): ProviderFlight[] {
    const rank: Record<string, number> = {
      scheduled: 1,
      checkin: 2,
      boarding: 3,
      delayed: 4,
      cancelled: 4,
      landing: 5,
      departed: 6,
      landed: 6,
      arrived: 6,
    };
    const known = (name: string) => /flyarystan|vietjet|qazaq|hi sky|air astana|scat/i.test(name);
    const byKey = new Map<string, ProviderFlight>();

    for (const item of items) {
      const key = `${item.flightNumber}|${item.direction}`;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, item);
        continue;
      }
      if (known(item.airlineName) !== known(current.airlineName)) {
        byKey.set(key, known(item.airlineName) ? item : current);
        continue;
      }
      const nextRank = rank[item.status] ?? 0;
      const currentRank = rank[current.status] ?? 0;
      byKey.set(key, nextRank >= currentRank ? item : current);
    }

    return [...byKey.values()];
  }

  private makeTodayAt(time: string): Date {
    const [hh, mm] = time.split(':');
    const { year, month, day } = this.airportNowParts();
    const hours = String(Number(hh) || 0).padStart(2, '0');
    const minutes = String(Number(mm) || 0).padStart(2, '0');
    return new Date(`${year}-${month}-${day}T${hours}:${minutes}:00+05:00`);
  }

  private async seedPlannedFlightsForToday(): Promise<number> {
    const seedEnabled =
      this.config.get<string>('FLIGHT_SYNC_SEED_PLANNED', 'true').toLowerCase() !== 'false';
    if (!seedEnabled) return 0;

    const storedPlan = await this.drizzle.db.select().from(flightScheduleEntries);
    if (storedPlan.length > 0) {
      return this.ensureTodayFromPlan(storedPlan);
    }

    const dayKey = this.getDayKey(new Date());
    const plan = WEEKLY_PLANNED[dayKey];
    if (!plan) return 0;

    const expected: ProviderFlight[] = [
      ...plan.departures
        .filter((item) => this.isPlanValidToday(item))
        .map((item) => this.mapPlanned(item, 'departure')),
      ...plan.arrivals
        .filter((item) => this.isPlanValidToday(item))
        .map((item) => this.mapPlanned(item, 'arrival')),
    ];

    let seeded = 0;

    for (const item of expected) {
      await this.removePastInstances(item.flightNumber, item.direction);

      const existing = await this.findExisting(item);
      if (existing) {
        if (!existing.scheduleLocked) {
          const [updated] = await this.drizzle.db
            .update(flights)
            .set({
              airlineName: item.airlineName,
              airlineCode: item.airlineCode,
              city: item.city,
              cityCode: item.cityCode,
              scheduledTime: item.scheduledTime,
              scheduleLocked: true,
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
          scheduleLocked: true,
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

  async triggerSync() {
    if (this.inProgress) {
      return { ok: true, skipped: true };
    }
    await this.runSync();
    return { ok: true, skipped: false };
  }

  async getScheduleBoard() {
    await this.ensureScheduleStorage();
    const [board] = await this.drizzle.db
      .select()
      .from(scheduleBoard)
      .where(eq(scheduleBoard.id, 1))
      .limit(1);
    const stored = await this.drizzle.db.select().from(flightScheduleEntries);
    const entries =
      stored.length > 0
        ? stored.map((row) => ({
            id: row.id,
            weekday: row.weekday,
            flightNumber: row.flightNumber,
            direction: row.direction,
            city: row.city,
            time: row.planTime,
          }))
        : this.defaultScheduleEntries();

    return {
      source: stored.length > 0 ? 'custom' : 'default',
      photoUrl: board?.photoUrl ?? null,
      entries,
    };
  }

  async saveSchedulePhoto(photoUrl: string) {
    await this.ensureScheduleStorage();
    await this.drizzle.db
      .insert(scheduleBoard)
      .values({ id: 1, photoUrl, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: scheduleBoard.id,
        set: { photoUrl, updatedAt: new Date() },
      });
    return { photoUrl };
  }

  async saveSchedulePlan(
    rawEntries: Array<{
      weekday: number;
      flightNumber: string;
      direction: string;
      city: string;
      time: string;
    }>,
  ) {
    await this.ensureScheduleStorage();
    const entries = rawEntries.map((entry) => this.normalizePlanEntry(entry));

    await this.drizzle.db.transaction(async (tx) => {
      await tx.delete(flightScheduleEntries);
      if (entries.length > 0) {
        await tx.insert(flightScheduleEntries).values(
          entries.map((entry) => ({
            weekday: entry.weekday,
            flightNumber: entry.flightNumber,
            direction: entry.direction,
            city: entry.city,
            planTime: entry.time,
          })),
        );
      }
    });

    await this.reloadAllowedRoutes();
    const applied = await this.applyPlanTimesForToday(entries);
    return { saved: entries.length, applied };
  }

  private async ensureScheduleStorage() {
    await this.drizzle.db.execute(sql`
      ALTER TABLE flights
      ADD COLUMN IF NOT EXISTS schedule_locked boolean NOT NULL DEFAULT false
    `);
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS flight_schedule_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        weekday smallint NOT NULL,
        flight_number varchar(32) NOT NULL,
        direction flight_direction NOT NULL,
        city varchar(120) NOT NULL,
        plan_time varchar(5) NOT NULL
      )
    `);
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS schedule_board (
        id integer PRIMARY KEY,
        photo_url text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.drizzle.db.execute(sql`
      INSERT INTO schedule_board (id, photo_url, updated_at)
      VALUES (1, NULL, now())
      ON CONFLICT (id) DO NOTHING
    `);
  }

  private async reloadAllowedRoutes() {
    this.configureAllowedRoutes();
    const [planRows, lockedRows] = await Promise.all([
      this.drizzle.db.select().from(flightScheduleEntries),
      this.drizzle.db.select().from(flights).where(eq(flights.scheduleLocked, true)),
    ]);

    for (const row of [...planRows, ...lockedRows]) {
      const flightNumber = this.normalizeFlightNumber(row.flightNumber);
      const city = this.normalizeCity(row.city);
      this.allowedRouteKeys.add(`${flightNumber}|${row.direction}|${city}`);
      this.allowedFlightDirectionKeys.add(`${flightNumber}|${row.direction}`);
    }
  }

  private defaultScheduleEntries() {
    const dayToWeekday: Record<keyof typeof WEEKLY_PLANNED, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };

    const entries: Array<{
      id: null;
      weekday: number;
      flightNumber: string;
      direction: 'arrival' | 'departure';
      city: string;
      time: string;
    }> = [];

    for (const [day, plan] of Object.entries(WEEKLY_PLANNED) as Array<
      [keyof typeof WEEKLY_PLANNED, (typeof WEEKLY_PLANNED)[keyof typeof WEEKLY_PLANNED]]
    >) {
      for (const item of plan.departures) {
        entries.push({
          id: null,
          weekday: dayToWeekday[day],
          flightNumber: item.flightNumber,
          direction: 'departure',
          city: item.city,
          time: item.time,
        });
      }
      for (const item of plan.arrivals) {
        entries.push({
          id: null,
          weekday: dayToWeekday[day],
          flightNumber: item.flightNumber,
          direction: 'arrival',
          city: item.city,
          time: item.time,
        });
      }
    }

    return entries;
  }

  private normalizePlanEntry(entry: {
    weekday: number;
    flightNumber: string;
    direction: string;
    city: string;
    time: string;
  }) {
    const weekday = Number(entry.weekday);
    const flightNumber = this.normalizeFlightNumber(entry.flightNumber ?? '');
    const city = String(entry.city ?? '').trim();
    const time = String(entry.time ?? '').trim();
    const direction = entry.direction === 'arrival' ? 'arrival' : 'departure';

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new BadRequestException('Некорректный день недели');
    }
    if (!flightNumber) {
      throw new BadRequestException('Укажите номер рейса');
    }
    if (!city) {
      throw new BadRequestException('Укажите город');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new BadRequestException(`Некорректное время у рейса ${flightNumber}`);
    }

    return { weekday, flightNumber, direction, city, time } as const;
  }

  private async ensureTodayFromPlan(
    rows: Array<{
      weekday: number;
      flightNumber: string;
      direction: 'arrival' | 'departure';
      city: string;
      planTime: string;
    }>,
  ) {
    const weekday = this.airportWeekday();
    let seeded = 0;

    for (const row of rows.filter((item) => item.weekday === weekday)) {
      const item = this.mapPlanned(
        { flightNumber: row.flightNumber, city: row.city, time: row.planTime },
        row.direction,
      );
      const existing = await this.findExisting(item);
      if (existing) continue;

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
          estimatedTime: null,
          status: this.mapPlannedStatus(item.direction, item.scheduledTime),
          scheduleLocked: true,
        })
        .returning();
      this.events.publish({ type: 'created', payload: created });
      seeded += 1;
    }

    return seeded;
  }

  private async applyPlanTimesForToday(
    entries: Array<{
      weekday: number;
      flightNumber: string;
      direction: 'arrival' | 'departure';
      city: string;
      time: string;
    }>,
  ) {
    const weekday = this.airportWeekday();
    let applied = 0;

    for (const entry of entries.filter((item) => item.weekday === weekday)) {
      const item = this.mapPlanned(
        { flightNumber: entry.flightNumber, city: entry.city, time: entry.time },
        entry.direction,
      );
      const existing = await this.findExisting(item);

      if (existing) {
        const [updated] = await this.drizzle.db
          .update(flights)
          .set({
            flightNumber: item.flightNumber,
            airlineName: item.airlineName,
            airlineCode: item.airlineCode,
            city: item.city,
            cityCode: item.cityCode,
            scheduledTime: item.scheduledTime,
            scheduleLocked: true,
            updatedAt: new Date(),
          })
          .where(eq(flights.id, existing.id))
          .returning();
        this.events.publish({ type: 'updated', payload: updated });
      } else {
        const [created] = await this.drizzle.db
          .insert(flights)
          .values({
            flightNumber: item.flightNumber,
            airlineName: item.airlineName,
            airlineCode: item.airlineCode,
            direction: item.direction,
            city: item.city,
            cityCode: item.cityCode,
            terminal: '1',
            gate: null,
            sector: null,
            scheduledTime: item.scheduledTime,
            estimatedTime: null,
            status: this.mapPlannedStatus(item.direction, item.scheduledTime),
            scheduleLocked: true,
          })
          .returning();
        this.events.publish({ type: 'created', payload: created });
      }

      applied += 1;
    }

    return applied;
  }
}
