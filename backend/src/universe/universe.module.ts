import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallLog } from '../calls/call-log.entity';
import { DncModule } from '../dnc/dnc.module';
import { User } from '../users/user.entity';
import { Voicemail } from '../voicemails/voicemail.entity';
import { CarePeopleService } from './care-people.service';
import { UniversePeopleController } from './universe-people.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CallLog, User, Voicemail]), DncModule],
  controllers: [UniversePeopleController],
  providers: [CarePeopleService],
})
export class UniverseModule {}
