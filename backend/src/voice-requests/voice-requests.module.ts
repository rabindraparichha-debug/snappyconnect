import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCallsModule } from '../ai-calls/ai-calls.module';
import { RecordingsService } from '../calls/recordings.service';
import { VoiceRequest } from './voice-request.entity';
import { VoiceRequestsController } from './voice-requests.controller';
import { VoiceRequestsService } from './voice-requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([VoiceRequest]), AiCallsModule],
  controllers: [VoiceRequestsController],
  providers: [VoiceRequestsService, RecordingsService],
})
export class VoiceRequestsModule {}
