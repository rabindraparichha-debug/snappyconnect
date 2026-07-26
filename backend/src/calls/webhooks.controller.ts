import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SmsService } from '../sms/sms.service';
import { CallsService } from './calls.service';

// Providers burst events during call storms; throttling them would drop
// state updates we can never recover.
@SkipThrottle()
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly callsService: CallsService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * Telnyx call/message event webhook. Configure this URL in the Telnyx
   * portal: https://<your-host>/api/v1/webhooks/telnyx
   */
  @Public()
  @Post('telnyx')
  @HttpCode(200)
  async telnyx(@Body() event: any) {
    await this.callsService.handleTelnyxWebhook(event);
    await this.smsService.handleTelnyxWebhook(event);
    return { received: true };
  }
}
