import { Body, Controller, Headers, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/decorators/public.decorator';
import { SupportLineService } from './support-line.service';

/**
 * The Dubai PBX's side of the support line. Asterisk's dialplan calls these
 * with curl while the caller waits (see deploy/asterisk-support-line.sh):
 *
 *   announce  -> "taskId,ref"   dial the AI at ref, or "" to ring everyone
 *   after     -> "hangup" | "ring" | "exten:2001"   once the AI leg has ended
 *   ended     -> the caller's own leg is gone
 *
 * Answers are plain text, since the dialplan has no JSON. A shared key in the
 * dialplan is the login; without it the PBX could not be told apart from
 * anyone else on this host.
 */
@SkipThrottle()
@Controller('webhooks/asterisk-support')
export class AsteriskSupportController {
  private readonly key: string;

  constructor(
    private readonly support: SupportLineService,
    config: ConfigService,
  ) {
    this.key = config.get<string>('ASTERISK_SUPPORT_KEY', '');
  }

  private check(given?: string) {
    const a = Buffer.from(this.key);
    const b = Buffer.from(given ?? '');
    if (!this.key || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
  }

  @Public()
  @Post('announce')
  @HttpCode(200)
  async announce(
    @Headers('x-support-key') key: string | undefined,
    @Body() body: { caller?: string; line?: string; channel?: string },
  ): Promise<string> {
    this.check(key);
    if (!body?.channel) return '';
    const ai = await this.support.announce(body.channel, body.caller || undefined, { provider: 'asterisk', to: body.line || undefined });
    return ai ? `${ai.taskId},${ai.ref}` : '';
  }

  @Public()
  @Post('after/:taskId')
  @HttpCode(200)
  async after(
    @Headers('x-support-key') key: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: { status?: string },
  ): Promise<string> {
    this.check(key);
    // Asterisk's DIALSTATUS: ANSWER means the AI picked up before its leg ended
    const next = await this.support.aiLegEnded(taskId, body?.status === 'ANSWER');
    if (next.action === 'hangup') return 'hangup';
    if (next.action === 'none') return 'hangup';
    const where = await this.support.nextExtension(next.person);
    return where.action === 'exten' ? `exten:${where.exten}` : 'ring';
  }

  @Public()
  @Post('ended')
  @HttpCode(200)
  async ended(@Headers('x-support-key') key: string | undefined, @Body() body: { channel?: string }): Promise<string> {
    this.check(key);
    if (body?.channel) await this.support.callerHungUp(body.channel);
    return 'ok';
  }
}
