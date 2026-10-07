import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, static as serveStatic, urlencoded } from 'express';
import { existsSync, mkdirSync } from 'fs';
import helmet from 'helmet';
import { join } from 'path';

import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 4000);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  const uploadsServicesDir = join(process.cwd(), 'uploads', 'services');
  const uploadsDocumentsDir = join(process.cwd(), 'uploads', 'documents');
  const uploadsSchedulesDir = join(process.cwd(), 'uploads', 'schedules');
  const uploadsAirlinesDir = join(process.cwd(), 'uploads', 'airlines');
  if (!existsSync(uploadsServicesDir)) {
    mkdirSync(uploadsServicesDir, { recursive: true });
  }
  if (!existsSync(uploadsDocumentsDir)) {
    mkdirSync(uploadsDocumentsDir, { recursive: true });
  }
  if (!existsSync(uploadsSchedulesDir)) {
    mkdirSync(uploadsSchedulesDir, { recursive: true });
  }
  if (!existsSync(uploadsAirlinesDir)) {
    mkdirSync(uploadsAirlinesDir, { recursive: true });
  }
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.use('/api/uploads', serveStatic(join(process.cwd(), 'uploads')));

  app.setGlobalPrefix('api');

  // Behind a reverse proxy (Cloudflare/nginx) the real client IP comes from
  // X-Forwarded-For; without this the rate limiter would count all users as one IP.
  app.set('trust proxy', 1);

  // Reject oversized payloads early — cheap flood/DoS protection.
  app.use(json({ limit: '200kb' }));
  app.use(urlencoded({ extended: true, limit: '200kb' }));

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
    }),
  );

  // In production only the domains listed in CORS_ORIGINS are allowed
  // (comma-separated, e.g. https://airportsemey.vercel.app,https://airport-abai.kz).
  const corsOriginsEnv = config.get<string>('CORS_ORIGINS', '');
  const prodOrigins = corsOriginsEnv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const devOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    /^http:\/\/localhost:\d+$/,
  ];
  app.enableCors({
    origin: isProduction && prodOrigins.length > 0 ? prodOrigins : [...devOrigins, ...prodOrigins],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (isProduction) {
    const jwtSecret = config.get<string>('JWT_SECRET', '');
    if (!jwtSecret || jwtSecret === 'dev_secret_change_me' || jwtSecret.length < 32) {
      logger.warn(
        'SECURITY: JWT_SECRET is missing/weak. Set a random string of at least 32 characters in production!',
      );
    }
    const adminPassword = config.get<string>('ADMIN_PASSWORD', '');
    if (!adminPassword || adminPassword === 'admin123' || adminPassword.length < 12) {
      logger.warn(
        'SECURITY: ADMIN_PASSWORD is default/weak. Set a strong password in production!',
      );
    }
    if (prodOrigins.length === 0) {
      logger.warn(
        'SECURITY: CORS_ORIGINS is not set — CORS will allow localhost. Add your production domains.',
      );
    }
  }

  await app.listen(port);
  logger.log(`API ready → http://localhost:${port}/api`);
  logger.log(`Health     → http://localhost:${port}/api/health`);
  logger.log(`Live SSE   → http://localhost:${port}/api/flights/stream`);
}

void bootstrap();
