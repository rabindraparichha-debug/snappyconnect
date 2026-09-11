import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { SmsController } from './sms.controller';
import { SmsLog } from './sms-log.entity';
import { User } from '../users/user.entity';
import { SmsBatch, SmsBatchItem } from './sms-batch.entity';
import { SmsBatchesController } from './sms-batches.controller';
import { SmsBatchesService } from './sms-batches.service';
import { SmsService } from './sms.service';
import { DncModule } from '../dnc/dnc.module';

@Module({
  imports: [TypeOrmModule.forFeature([SmsLog, SmsBatch, SmsBatchItem, User]), ProvidersModule, NotificationsModule, ActivityModule, WebhooksModule, DncModule],
  controllers: [SmsBatchesController, SmsController],
  providers: [SmsService, SmsBatchesService],
  exports: [SmsService],
})
export class SmsModule {}
