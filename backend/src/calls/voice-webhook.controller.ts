import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';
import { TelnyxApiService } from '../providers/telnyx-api.service';
import { User } from '../users/user.entity';

/**
 * Call Control webhook for the shared board line: answers, reads a menu, and
 * transfers the caller to the chosen recruiter's direct line. Recruiters are
 * mapped to menu digits via providerConfig.ivrDigit (set in the Users page).
 *
 * Configure this URL on the Telnyx Voice API application:
 *   https://<host>/api/v1/webhooks/telnyx-voice
 */
@SkipThrottle()
@Controller('webhooks')
export class VoiceWebhookController {
  private readonly logger = new Logger(VoiceWebhookController.name);

  constructor(
    private readonly telnyx: TelnyxApiService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  @Public()
  @Post('telnyx-voice')
  @HttpCode(200)
  async voice(@Body() event: any) {
    const type: string | undefined = event?.data?.event_type;
    const payload = event?.data?.payload;
    const callControlId: string | undefined = payload?.call_control_id;
    if (!type || !callControlId) return { received: true };

    // Only inbound legs run the menu; our own transfer legs must pass through.
    const isInbound = payload?.direction === 'incoming';

    try {
      switch (type) {
        case 'call.initiated':
          if (isInbound) await this.telnyx.answerCall(callControlId);
          break;

        case 'call.answered':
          if (isInbound) await this.playMenu(callControlId);
          break;

        case 'call.gather.ended': {
          const digit: string = payload?.digits ?? '';
          await this.routeDigit(callControlId, digit, payload?.to);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      this.logger.error(`Voice webhook ${type} failed: ${(err as Error).message}`);
    }
    return { received: true };
  }

  private async playMenu(callControlId: string): Promise<void> {
    const recruiters = await this.recruitersByDigit();
    const options = [...recruiters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([digit, user]) => `press ${digit} for ${user.name}`)
      .join(', ');

    const prompt = options
      ? `Thank you for calling. ${options}. Or stay on the line to leave a message.`
      : 'Thank you for calling SnappyConnect. No agents are configured yet. Goodbye.';

    if (!options) {
      await this.telnyx.speak(callControlId, prompt);
      await this.telnyx.hangup(callControlId);
      return;
    }
    await this.telnyx.gatherDigits(callControlId, prompt, [...recruiters.keys()].join(''));
  }

  private async routeDigit(callControlId: string, digit: string, boardNumber?: string) {
    const recruiters = await this.recruitersByDigit();
    const target = recruiters.get(digit);
    const destination = target?.providerConfig?.telnyxNumber ?? target?.mobileNumber;

    if (!destination) {
      await this.telnyx.speak(callControlId, 'That extension is unavailable. Goodbye.');
      await this.telnyx.hangup(callControlId);
      return;
    }

    await this.telnyx.speak(callControlId, `Connecting you to ${target!.name}.`);
    // Keep the board line as caller ID so the recruiter sees which line rang.
    await this.telnyx.transfer(callControlId, destination, boardNumber);
  }

  /** Users with a menu digit assigned, keyed by that digit. */
  private async recruitersByDigit(): Promise<Map<string, User>> {
    const users = await this.usersRepo.find({ where: { status: 'active' as any } });
    const map = new Map<string, User>();
    for (const user of users) {
      const digit = user.providerConfig?.ivrDigit;
      if (digit && /^[1-9]$/.test(String(digit))) map.set(String(digit), user);
    }
    return map;
  }
}
