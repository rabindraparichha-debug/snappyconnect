import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersModule } from '../providers/providers.module';
import { CallLog } from './call-log.entity';
import { CallRequest } from './call-request.entity';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CallLog, CallRequest]), ProvidersModule],
  controllers: [CallsController, WebhooksController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
