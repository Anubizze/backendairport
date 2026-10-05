import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import {
  flightStatusHistory,
  flightSubscriptions,
  flights,
  notificationLog,
  users,
} from '../db/schema';
import { AuthUser } from '../auth/auth-user.interface';
import { NotificationsService } from '../notifications/notifications.service';

import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsEventsService } from './flights.events';
import { QueryFlightsDto } from './dto/query-flights.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';

@Injectable()
export class FlightsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly events: FlightsEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  private throwDbError(error: unknown, context: string): never {
    const e = error as {
      code?: string;
      errno?: string | number;
      syscall?: string;
      routine?: string;
      message?: string;
    };
    const parts = [
      `context=${context}`,
      `code=${e?.code ?? 'unknown'}`,
      `errno=${e?.errno ?? 'unknown'}`,
      `syscall=${e?.syscall ?? 'unknown'}`,
      `routine=${e?.routine ?? 'unknown'}`,
    ];
    throw new BadRequestException(`DB_ERROR ${parts.join(' ')}`);
  }

  private parseDateInput(value: string | Date | null | undefined, fieldName: string): Date | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new BadRequestException(`Некорректная дата в поле "${fieldName}"`);
      }
      return value;
    }

    // Try native Date parse first (ISO / datetime-local)
    const nativeParsed = new Date(value);
    if (!Number.isNaN(nativeParsed.getTime())) {
      return nativeParsed;
    }

    // Fallback for localized format: dd.mm.yyyy hh:mm
    const localizedMatch = value.match(
      /^(\d{2})\.(\d{2})\.(\d{4})[,\s]+(\d{2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (localizedMatch) {
      const [, dd, mm, yyyy, hh, mi, ss] = localizedMatch;
      const parsed = new Date(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(mi),
        Number(ss ?? '0'),
      );
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    throw new BadRequestException(`Некорректный формат даты в поле "${fieldName}"`);
  }

  async findAll(query: QueryFlightsDto) {
    const conditions = [];

    if (query.direction) {
      conditions.push(eq(flights.direction, query.direction));
    }

    if (query.search) {
      const pattern = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(flights.flightNumber, pattern),
          ilike(flights.city, pattern),
          ilike(flights.airlineName, pattern),
        ),
      );
    }

    try {
      const rows = await this.drizzle.db
        .select()
        .from(flights)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(flights.scheduledTime));

      // Strict mode for board output:
      // keep only the freshest record per flight number + direction.
      // This prevents older seeded rows from appearing when live sync rows exist.
      const byFlight = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const key = `${row.direction}|${row.flightNumber.trim().toUpperCase()}`;
        const existing = byFlight.get(key);
        if (!existing) {
          byFlight.set(key, row);
          continue;
        }

        const existingTs = existing.updatedAt?.getTime() ?? existing.createdAt.getTime();
        const nextTs = row.updatedAt?.getTime() ?? row.createdAt.getTime();
        if (nextTs > existingTs) {
          byFlight.set(key, row);
        }
      }

      return [...byFlight.values()].sort(
        (a, b) => b.scheduledTime.getTime() - a.scheduledTime.getTime(),
      );
    } catch (error) {
      this.throwDbError(error, 'findAll');
    }
  }

  async findOne(id: string) {
    const [flight] = await this.drizzle.db
      .select()
      .from(flights)
      .where(eq(flights.id, id))
      .limit(1);

    if (!flight) {
      throw new NotFoundException('Flight not found');
    }
    return flight;
  }

  async getStatusHistory(limit = 200) {
    const safeLimit = Math.min(Math.max(limit, 1), 500);

    try {
      return await this.drizzle.db
        .select({
          id: flightStatusHistory.id,
          flightId: flightStatusHistory.flightId,
          flightNumber: flights.flightNumber,
          previousStatus: flightStatusHistory.previousStatus,
          newStatus: flightStatusHistory.newStatus,
          changedByUserId: flightStatusHistory.changedByUserId,
          changedByLogin: users.email,
          note: flightStatusHistory.note,
          createdAt: flightStatusHistory.createdAt,
        })
        .from(flightStatusHistory)
        .leftJoin(flights, eq(flightStatusHistory.flightId, flights.id))
        .leftJoin(users, eq(flightStatusHistory.changedByUserId, users.id))
        .orderBy(desc(flightStatusHistory.createdAt))
        .limit(safeLimit);
    } catch (error) {
      this.throwDbError(error, 'getStatusHistory');
    }
  }

  async create(dto: CreateFlightDto) {
    const scheduledTime = this.parseDateInput(dto.scheduledTime, 'scheduledTime');
    if (!scheduledTime) {
      throw new BadRequestException('Поле "scheduledTime" обязательно');
    }
    const estimatedTime = this.parseDateInput(dto.estimatedTime, 'estimatedTime');

    let created;
    try {
      const normalizedFlightNumber = dto.flightNumber.replace(/\s+/g, '').trim();
      const normalizedAirlineCode = dto.airlineCode.toUpperCase();
      const airlineName =
        normalizedAirlineCode === 'IH' && !dto.airlineName.trim()
          ? 'Hi Sky'
          : dto.airlineName;

      [created] = await this.drizzle.db
        .insert(flights)
        .values({
          flightNumber: normalizedFlightNumber,
          airlineName,
          airlineCode: normalizedAirlineCode,
          direction: dto.direction,
          city: dto.city,
          cityCode: dto.cityCode,
          terminal: dto.terminal ?? '1',
          sector: dto.sector ?? null,
          gate: dto.gate ?? null,
          scheduledTime,
          estimatedTime,
          status: dto.status ?? 'scheduled',
        })
        .returning();

      // Admin-created flights are protected from automatic sync overwrites.
      [created] = await this.drizzle.db
        .update(flights)
        .set({ updatedAt: new Date(Date.now() + 60_000) })
        .where(eq(flights.id, created.id))
        .returning();
    } catch (error) {
      this.throwDbError(error, 'create');
    }

    this.events.publish({
      type: 'created',
      payload: created,
    });

    return created;
  }

  async update(id: string, dto: UpdateFlightDto, actor?: AuthUser) {
    const current = await this.findOne(id);

    let scheduledTime: Date = current.scheduledTime;
    if (dto.scheduledTime !== undefined) {
      const parsedScheduledTime = this.parseDateInput(dto.scheduledTime, 'scheduledTime');
      if (!parsedScheduledTime) {
        throw new BadRequestException('Поле "scheduledTime" не может быть пустым');
      }
      scheduledTime = parsedScheduledTime;
    }

    const estimatedTime = dto.estimatedTime
      ? this.parseDateInput(dto.estimatedTime, 'estimatedTime')
      : current.estimatedTime;

    const [updated] = await this.drizzle.db
      .update(flights)
      .set({
        flightNumber: dto.flightNumber
          ? dto.flightNumber.replace(/\s+/g, '').trim()
          : current.flightNumber,
        airlineName: dto.airlineName ?? current.airlineName,
        airlineCode: dto.airlineCode ? dto.airlineCode.toUpperCase() : current.airlineCode,
        direction: dto.direction ?? current.direction,
        city: dto.city ?? current.city,
        cityCode: dto.cityCode ?? current.cityCode,
        terminal: dto.terminal ?? current.terminal,
        sector: dto.sector ?? current.sector,
        gate: dto.gate ?? current.gate,
        scheduledTime,
        estimatedTime,
        status: dto.status ?? current.status,
        updatedAt: new Date(),
      })
      .where(eq(flights.id, id))
      .returning();

    if (!updated) {
      throw new BadRequestException('Failed to update flight');
    }

    if (dto.status && dto.status !== current.status) {
      await this.drizzle.db.insert(flightStatusHistory).values({
        flightId: id,
        previousStatus: current.status,
        newStatus: dto.status,
        changedByUserId: actor?.id ?? null,
        note: actor ? `Status changed by ${actor.login} (${actor.role})` : null,
      });

      const subscriptions = await this.drizzle.db
        .select()
        .from(flightSubscriptions)
        .where(eq(flightSubscriptions.flightId, id));

      for (const subscription of subscriptions) {
        const sent = await this.notifications.sendFlightStatusChangedEmail({
          to: subscription.email,
          flightNumber: updated.flightNumber,
          city: updated.city,
          direction: updated.direction,
          previousStatus: current.status ?? null,
          newStatus: dto.status,
        });

        await this.drizzle.db.insert(notificationLog).values({
          subscriptionId: subscription.id,
          flightId: id,
          statusSent: dto.status,
          channel: 'email',
          wasSuccessful: sent.success ? 1 : 0,
          errorMessage: sent.error ?? null,
        });
      }
    }

    this.events.publish({
      type: 'updated',
      payload: updated,
    });

    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.drizzle.db
      .delete(flights)
      .where(eq(flights.id, id))
      .returning({ id: flights.id });

    if (!deleted) {
      throw new NotFoundException('Flight not found');
    }

    this.events.publish({
      type: 'deleted',
      payload: { id },
    });

    return { deleted: true, id };
  }
}
