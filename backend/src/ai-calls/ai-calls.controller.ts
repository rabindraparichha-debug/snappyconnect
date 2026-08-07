import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../users/user.entity';
import { AiCallsService } from './ai-calls.service';
import { DispatchAiCallDto } from './dto/dispatch-ai-call.dto';

/**
 * Dispatch calls to the shared AI voice agent (USA via Vitel, UAE via the
 * Dinstar SIM path) and receive its outcomes back into call history.
 */
@ApiTags('AI calls')
@Controller('ai-calls')
export class AiCallsController {
  constructor(private readonly aiCalls: AiCallsService) {}

  @ApiBearerAuth()
  @Post()
  dispatch(@CurrentUser() user: User, @Body() dto: DispatchAiCallDto) {
    return this.aiCalls.dispatch(user, dto);
  }

  /** Voice-platform callback: events and final results, HMAC-signed. */
  @Public()
  @SkipThrottle()
  @Post('result')
  @HttpCode(200)
  result(
    @Headers('x-vp-signature') signature: string | undefined,
    @Headers('x-vp-timestamp') timestamp: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    return this.aiCalls.handleAgentCallback(
      signature,
      timestamp,
      req.rawBody,
      payload,
    );
  }
}
