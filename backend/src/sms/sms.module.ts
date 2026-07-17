import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersModule } from '../providers/providers.module';
import { SmsController } from './sms.controller';
import { SmsLog } from './sms-log.entity';
import { SmsService } from './sms.service';

@Module({
  imports: [TypeOrmModule.forFeature([SmsLog]), ProvidersModule],
  controllers: [SmsController],
  providers: [SmsService],
})
export class SmsModule {}
