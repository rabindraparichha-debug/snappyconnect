import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CallsService } from './calls.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly callsService: CallsService) {}

  /**
   * Telnyx call/message event webhook. Configure this URL in the Telnyx
   * portal: https://<your-host>/api/v1/webhooks/telnyx
   */
  @Public()
  @Post('telnyx')
  @HttpCode(200)
  async telnyx(@Body() event: any) {
    await this.callsService.handleTelnyxWebhook(event);
    return { received: true };
  }
}
