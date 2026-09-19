import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { User } from '../users/user.entity';
import { AiCallsService } from './ai-calls.service';
import { ComposeSmsDto } from './dto/compose-sms.dto';
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

  /**
   * Draft one SMS from a rough brief. Available to any user who can send SMS;
   * the draft is only ever a suggestion — nothing is sent from here.
   */
  @ApiBearerAuth()
  @Post('compose')
  compose(@Body() dto: ComposeSmsDto) {
    return this.aiCalls.compose(dto);
  }

  /** Voices an admin can assign to the AI agent. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('voices')
  voices() {
    return this.aiCalls.voices();
  }

  /**
   * Clone a voice from an uploaded sample (admins only).
   *
   * Consent is the operator's responsibility: only upload a recording of
   * someone who has agreed their voice may be cloned.
   */
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('voices/clone')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  cloneVoice(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { name?: string; provider?: string },
  ) {
    if (!file) throw new BadRequestException('An audio sample is required.');
    const name = (body?.name ?? '').trim();
    if (!name) throw new BadRequestException('A name for the voice is required.');
    const provider = body?.provider === 'elevenlabs' ? 'elevenlabs' : 'cartesia';
    return this.aiCalls.cloneVoice(name, file, provider);
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
