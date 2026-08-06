import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallLog } from '../calls/call-log.entity';
import { DncModule } from '../dnc/dnc.module';
import { User } from '../users/user.entity';
import { AiCallsController } from './ai-calls.controller';
import { AiCallsService } from './ai-calls.service';

@Module({
  imports: [TypeOrmModule.forFeature([CallLog, User]), DncModule],
  controllers: [AiCallsController],
  providers: [AiCallsService],
})
export class AiCallsModule {}
