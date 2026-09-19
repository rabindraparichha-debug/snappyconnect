import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantOrmModule } from '../common/tenant-orm.module';
import { CallLog } from '../calls/call-log.entity';
import { DncModule } from '../dnc/dnc.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { AiCallsController } from './ai-calls.controller';
import { AiCallsService } from './ai-calls.service';

@Module({
  imports: [TypeOrmModule.forFeature([CallLog, User]), TenantOrmModule.forFeature([CallLog, User]), DncModule, NotificationsModule],
  controllers: [AiCallsController],
  providers: [AiCallsService],
  exports: [AiCallsService],
})
export class AiCallsModule {}
