import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { DrizzleModule } from './db/drizzle.module';
import { FlightSyncModule } from './flight-sync/flight-sync.module';
import { FlightsModule } from './flights/flights.module';
import { HealthModule } from './health/health.module';
import { NewsModule } from './news/news.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { ServicePhotosModule } from './service-photos/service-photos.module';
import { PartnerDocumentsModule } from './partner-documents/partner-documents.module';
import { FeedbackModule } from './feedback/feedback.module';
import { FuelStorageModule } from './fuel-storage/fuel-storage.module';
import { AirlinesModule } from './airlines/airlines.module';
import { ServicePricesModule } from './service-prices/service-prices.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Global rate limit: protects the API from floods and brute force.
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1_000,
        limit: 20,
      },
      {
        name: 'medium',
        ttl: 60_000,
        limit: 300,
      },
    ]),
    AuthModule,
    DrizzleModule,
    HealthModule,
    NewsModule,
    FlightsModule,
    FlightSyncModule,
    SubscriptionsModule,
    VacanciesModule,
    ServicePhotosModule,
    PartnerDocumentsModule,
    FeedbackModule,
    FuelStorageModule,
    AirlinesModule,
    ServicePricesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
