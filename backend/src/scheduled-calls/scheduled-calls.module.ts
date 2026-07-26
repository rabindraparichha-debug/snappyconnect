import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledCall } from './scheduled-call.entity';
import { ScheduledCallsController } from './scheduled-calls.controller';
import { ScheduledCallsService } from './scheduled-calls.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduledCall]), NotificationsModule],
  controllers: [ScheduledCallsController],
  providers: [ScheduledCallsService],
  exports: [ScheduledCallsService],
})
export class ScheduledCallsModule {}
