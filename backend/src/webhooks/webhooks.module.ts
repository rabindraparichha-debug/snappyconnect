import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './webhook.entity';
import { WebhooksAdminController } from './webhooks-admin.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Webhook])],
  controllers: [WebhooksAdminController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
