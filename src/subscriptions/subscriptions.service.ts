import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { flightSubscriptions, flights } from '../db/schema';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(dto: CreateSubscriptionDto) {
    const [flight] = await this.drizzle.db
      .select({ id: flights.id })
      .from(flights)
      .where(eq(flights.id, dto.flightId))
      .limit(1);

    if (!flight) {
      throw new BadRequestException('Рейс не найден');
    }

    const [subscription] = await this.drizzle.db
      .insert(flightSubscriptions)
      .values({
        flightId: dto.flightId,
        email: dto.email.toLowerCase(),
      })
      .onConflictDoNothing()
      .returning();

    if (subscription) {
      return {
        created: true,
        subscription,
      };
    }

    return {
      created: false,
      message: 'Вы уже подписаны на уведомления по этому рейсу',
    };
  }
}
