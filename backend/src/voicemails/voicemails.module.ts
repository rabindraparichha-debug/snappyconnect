import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordingsService } from '../calls/recordings.service';
import { VoicemailsController } from './voicemails.controller';
import { VoicemailsService } from './voicemails.service';
import { Voicemail } from './voicemail.entity';

@Module({
  // RecordingsService is stateless file plumbing, so it is provided directly
  // rather than importing CallsModule — which imports this module in turn.
  imports: [TypeOrmModule.forFeature([Voicemail])],
  controllers: [VoicemailsController],
  providers: [VoicemailsService, RecordingsService],
  exports: [VoicemailsService],
})
export class VoicemailsModule {}
