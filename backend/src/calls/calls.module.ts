import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { SmsModule } from '../sms/sms.module';
import { CallLog } from './call-log.entity';
import { CallRequest } from './call-request.entity';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CallLog, CallRequest]), ProvidersModule, SmsModule, NotificationsModule],
  controllers: [CallsController, WebhooksController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
