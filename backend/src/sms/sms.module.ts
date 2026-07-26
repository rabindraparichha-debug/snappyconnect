import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../providers/providers.module';
import { SmsController } from './sms.controller';
import { SmsLog } from './sms-log.entity';
import { SmsService } from './sms.service';

@Module({
  imports: [TypeOrmModule.forFeature([SmsLog]), ProvidersModule, NotificationsModule],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
