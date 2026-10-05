import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

type SendStatusMailParams = {
  to: string;
  flightNumber: string;
  city: string;
  direction: 'arrival' | 'departure';
  previousStatus: string | null;
  newStatus: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT', '587'));
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    this.from = this.configService.get<string>('SMTP_FROM', 'no-reply@airport-semey.local');

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn(
        'SMTP is not configured. Subscription emails will be logged only.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });
  }

  async sendFlightStatusChangedEmail(params: SendStatusMailParams): Promise<{
    success: boolean;
    error?: string;
  }> {
    const directionLabel = params.direction === 'departure' ? 'Вылет' : 'Прилёт';
    const previous = params.previousStatus ?? '—';
    const subject = `Обновление статуса рейса ${params.flightNumber}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
        <h2 style="margin: 0 0 12px;">Статус рейса обновлён</h2>
        <p><strong>Рейс:</strong> ${params.flightNumber}</p>
        <p><strong>Тип:</strong> ${directionLabel}</p>
        <p><strong>Город:</strong> ${params.city}</p>
        <p><strong>Было:</strong> ${previous}</p>
        <p><strong>Стало:</strong> ${params.newStatus}</p>
      </div>
    `;

    if (!this.transporter) {
      return {
        success: false,
        error: 'SMTP is not configured',
      };
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        subject,
        html,
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send email';
      return { success: false, error: message };
    }
  }

  async sendContactFeedbackEmail(params: {
    to: string;
    replyTo: string;
    name: string;
    subject: string;
    message: string;
  }): Promise<{ success: boolean; error?: string }> {
    const subject = `[Аэропорт Семей] ${params.subject}`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
        <h2 style="margin: 0 0 12px;">Новое обращение с сайта</h2>
        <p><strong>Имя:</strong> ${params.name}</p>
        <p><strong>Email:</strong> ${params.replyTo}</p>
        <p><strong>Тема:</strong> ${params.subject}</p>
        <p><strong>Сообщение:</strong></p>
        <p style="white-space: pre-wrap;">${params.message}</p>
      </div>
    `;

    if (!this.transporter) {
      this.logger.log(
        `Contact feedback (SMTP off): ${params.name} <${params.replyTo}> — ${params.subject}`,
      );
      return { success: false, error: 'SMTP is not configured' };
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: params.to,
        replyTo: params.replyTo,
        subject,
        html,
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send email';
      return { success: false, error: message };
    }
  }
}
