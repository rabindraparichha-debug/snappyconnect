import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';
import { DEFAULT_GREETING } from '../providers/numbers.controller';
import { TelnyxApiService } from '../providers/telnyx-api.service';
import { SettingsService } from '../settings/settings.service';
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
    private readonly settings: SettingsService,
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
          // No digits means the caller waited — that is the operator request.
          if (!digit) {
            await this.transferToOperator(callControlId, payload?.to);
          } else {
            await this.routeDigit(callControlId, digit, payload?.to);
          }
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
    const [recruiters, cfg] = await Promise.all([
      this.recruitersByDigit(),
      this.settings.getProviderSettings('telnyx'),
    ]);

    const options = [...recruiters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([digit, user]) => `For ${user.name}, press ${digit}.`)
      .join(' ');

    // {options} lets the admin place the extension list inside their own wording.
    const template: string = cfg.ivrGreeting || DEFAULT_GREETING;
    const prompt = template.includes('{options}')
      ? template.replace('{options}', options)
      : `${template} ${options}`.trim();

    if (recruiters.size === 0) {
      // Nobody has a digit — go straight to whoever answers the main line.
      await this.telnyx.speak(callControlId, template.replace('{options}', '').trim());
      await this.transferToOperator(callControlId);
      return;
    }
    await this.telnyx.gatherDigits(callControlId, prompt, [...recruiters.keys()].join(''));
  }

  /**
   * Nobody pressed a digit (or no extensions exist): ring the operator. Falls
   * back to the first extension so a caller is never dropped in silence.
   */
  private async transferToOperator(callControlId: string, boardNumber?: string): Promise<void> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    let operator: User | null = null;

    if (cfg.operatorUserId) {
      operator = await this.usersRepo.findOne({ where: { id: cfg.operatorUserId } });
    }
    if (!operator) {
      const recruiters = await this.recruitersByDigit();
      operator = [...recruiters.values()][0] ?? null;
    }

    const destination = operator?.providerConfig?.telnyxNumber ?? operator?.mobileNumber;
    if (!destination) {
      await this.telnyx.speak(
        callControlId,
        'Sorry, nobody is available to take your call right now. Please try again later.',
      );
      await this.telnyx.hangup(callControlId);
      return;
    }

    await this.telnyx.speak(callControlId, 'Connecting you to an operator.');
    await this.telnyx.transfer(callControlId, destination, boardNumber);
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
