import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { LotsModule } from './lots/lots.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { WeatherModule } from './weather/weather.module';
import { AuthModule } from './auth/auth.module';
import { OccupancyEventsModule } from './occupancy-events/occupancy-events.module';
import { ReliabilityModule } from './reliability/reliability.module';
import { HealthModule } from './health/health.module';
import { appConfig, authConfig, dbConfig, privacyConfig, weatherConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, dbConfig, privacyConfig, weatherConfig],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    // Rate limiting: 20 requests per 10-second window per IP
    ThrottlerModule.forRoot([{ ttl: 10_000, limit: 20 }]),
    LotsModule,
    UsersModule,
    EventsModule,
    WeatherModule,
    AuthModule,
    OccupancyEventsModule,
    ReliabilityModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
