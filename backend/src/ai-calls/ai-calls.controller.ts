import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
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

  /** The caller's own AI calls in progress (admins see everyone's). */
  @ApiBearerAuth()
  @Get('active')
  active(@CurrentUser() user: User) {
    return this.aiCalls.activeCalls(user);
  }

  @ApiBearerAuth()
  @Post(':platformCallId/listen-token')
  listenToken(
    @CurrentUser() user: User,
    @Param('platformCallId') platformCallId: string,
    @Body() body: { publish?: boolean },
  ) {
    return this.aiCalls.listenToken(user, platformCallId, Boolean(body?.publish));
  }

  @ApiBearerAuth()
  @Post(':platformCallId/takeover')
  takeover(@CurrentUser() user: User, @Param('platformCallId') platformCallId: string) {
    return this.aiCalls.takeover(user, platformCallId);
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
