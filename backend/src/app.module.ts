import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProvidersModule } from './providers/providers.module';
import { SeedModule } from './seed/seed.module';
import { SettingsModule } from './settings/settings.module';
import { SmsModule } from './sms/sms.module';
import { ActivityModule } from './activity/activity.module';
import { ScheduledCallsModule } from './scheduled-calls/scheduled-calls.module';
import { ScriptsModule } from './scripts/scripts.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AuditModule } from './audit/audit.module';
import { ContactListsModule } from './contact-lists/contact-lists.module';
import { DncModule } from './dnc/dnc.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Blanket limit for the API. Individual routes tighten this with
    // @Throttle (login) or opt out with @SkipThrottle (provider webhooks).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: parseInt(config.get<string>('DATABASE_PORT', '5432'), 10),
        username: config.get<string>('DATABASE_USER', 'postgres'),
        password: config.get<string>('DATABASE_PASSWORD', 'postgres'),
        database: config.get<string>('DATABASE_NAME', 'snappyconnect'),
        autoLoadEntities: true,
        synchronize: config.get<string>('DATABASE_SYNCHRONIZE', 'true') === 'true',
      }),
    }),
    AiModule,
    AnalyticsModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    ProvidersModule,
    CallsModule,
    SmsModule,
    DashboardModule,
    NotificationsModule,
    ActivityModule,
    ScheduledCallsModule,
    ScriptsModule,
    WebhooksModule,
    AuditModule,
    ContactListsModule,
    DncModule,
    SeedModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
