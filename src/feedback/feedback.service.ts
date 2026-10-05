import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { feedbackMessages } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';

import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService implements OnModuleInit {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureStorage();
  }

  async create(dto: CreateFeedbackDto) {
    const [saved] = await this.drizzle.db
      .insert(feedbackMessages)
      .values({
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        subject: dto.subject.trim(),
        message: dto.message.trim(),
      })
      .returning();

    const inbox =
      this.config.get<string>('CONTACT_EMAIL_TO')?.trim() || 'airportsemey@mail.ru';

    const mailResult = await this.notifications.sendContactFeedbackEmail({
      to: inbox,
      replyTo: saved.email,
      name: saved.name,
      subject: saved.subject,
      message: saved.message,
    });

    if (mailResult.success) {
      await this.drizzle.db
        .update(feedbackMessages)
        .set({ emailSent: true })
        .where(eq(feedbackMessages.id, saved.id));
    } else {
      this.logger.warn(
        `Feedback saved (${saved.id}) but email failed: ${mailResult.error ?? 'unknown'}`,
      );
    }

    return {
      ok: true,
      id: saved.id,
      emailSent: mailResult.success,
    };
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS "feedback_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "subject" varchar(255) NOT NULL,
        "message" text NOT NULL,
        "email_sent" boolean DEFAULT false NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
  }
}
