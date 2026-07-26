import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  // Uptime monitors poll this; a throttled health check reads as an outage.
  @SkipThrottle()
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'snappyconnect-api', time: new Date().toISOString() };
  }
}
