import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DncModule } from '../dnc/dnc.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { SmsModule } from '../sms/sms.module';
import { CallLog } from './call-log.entity';
import { CallRequest } from './call-request.entity';
import { User } from '../users/user.entity';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { VoiceWebhookController } from './voice-webhook.controller';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallLog, CallRequest, User]),
    ProvidersModule,
    SmsModule,
    NotificationsModule,
    ActivityModule,
    WebhooksModule,
    DncModule,
  ],
  controllers: [CallsController, WebhooksController, VoiceWebhookController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
