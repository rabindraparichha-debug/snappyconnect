import { BadRequestException, Injectable } from '@nestjs/common';
import { CallingProvider, CallSource } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import { AsteriskAmiService } from './asterisk-ami.service';
import {
  CallingProviderStrategy,
  InitiateCallInput,
  InitiateCallResult,
} from './provider.interface';

/**
 * Self-hosted Asterisk (UAE). The mobile app registers as the user's own SIP
 * account over an encrypted WebSocket (WSS + WebRTC — plain SIP is blocked by
 * UAE ISPs) and dials in-app. Asterisk forwards calls through the register
 * trunk to the on-premise UCM → Dinstar → SIM. Per-recruiter identity lives in
 * the SIP account; Asterisk always presents caller ID 1002 to the UCM (the
 * only CID its outbound route accepts).
 */
@Injectable()
export class AsteriskProvider implements CallingProviderStrategy {
  readonly key = CallingProvider.ASTERISK;

  constructor(
    private readonly settings: SettingsService,
    private readonly ami: AsteriskAmiService,
  ) {}

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    // From the mobile app the built-in SIP dialer places the call itself.
    if (input.source === CallSource.MOBILE) {
      return {
        action: 'client_dial',
        provider: this.key,
        phoneNumber: input.phoneNumber,
        message: 'Dial from the SnappyConnect mobile app — the in-app dialer will place the call.',
      };
    }

    // Click-to-call from the browser or Chrome extension: Asterisk rings the
    // recruiter's own line first, then dials the candidate when they answer.
    const sipUsername: string | undefined = input.user.providerConfig?.sipUsername;
    if (!sipUsername) {
      throw new BadRequestException(
        'No SIP line assigned. Ask an admin to set your SIP username in Users.',
      );
    }

    try {
      await this.ami.originate({
        channel: `PJSIP/${sipUsername}`,
        context: 'recruiters',
        exten: input.phoneNumber,
        callerId: `${input.user.name} <${sipUsername}>`,
        variables: { SNAPPY_USER_ID: input.user.id },
      });
    } catch (err) {
      throw new BadRequestException(
        `Could not start the call: ${(err as Error).message}`,
      );
    }

    return {
      action: 'pbx_originated',
      provider: this.key,
      phoneNumber: input.phoneNumber,
      message: `Your line (${sipUsername}) is ringing — answer it and the candidate will be dialed.`,
    };
  }

  /** SIP connection details for the mobile app's built-in softphone. */
  async getClientConfig(user: User): Promise<{
    wssUrl: string;
    sipDomain: string;
    sipUsername: string;
    sipPassword: string;
    displayName: string;
  }> {
    const cfg = await this.settings.getProviderSettings('asterisk');
    if (!cfg.wssUrl) {
      throw new BadRequestException(
        'Asterisk is not configured. Ask an admin to set the WSS URL in Settings.',
      );
    }
    const sipUsername: string | undefined = user.providerConfig?.sipUsername;
    const sipPassword: string | undefined = user.providerConfig?.sipPassword;
    if (!sipUsername || !sipPassword) {
      throw new BadRequestException(
        'No SIP account assigned. Ask an admin to set your SIP username/password in Users.',
      );
    }
    const sipDomain: string = cfg.domain || new URL(cfg.wssUrl.replace(/^wss/, 'https')).hostname;
    return { wssUrl: cfg.wssUrl, sipDomain, sipUsername, sipPassword, displayName: user.name };
  }
}
