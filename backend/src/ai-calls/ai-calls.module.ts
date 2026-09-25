import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallLog } from '../calls/call-log.entity';
import { CallsModule } from '../calls/calls.module';
import { DncModule } from '../dnc/dnc.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { AiCallsController } from './ai-calls.controller';
import { AiCallsService } from './ai-calls.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallLog, User]),
    DncModule,
    NotificationsModule,
    // Provides CallLimitsService, which dispatch checks before placing a call.
    CallsModule,
  ],
  controllers: [AiCallsController],
  providers: [AiCallsService],
  exports: [AiCallsService],
})
export class AiCallsModule {}
