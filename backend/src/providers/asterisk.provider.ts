import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallingProvider, CallSource } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import {
  CallingProviderStrategy,
  InitiateCallInput,
  InitiateCallResult,
} from './provider.interface';

/**
 * Self-hosted Asterisk (UAE). Every surface dials the candidate directly: the
 * mobile app and the web dialer each register as the user's own SIP account
 * over an encrypted WebSocket (WSS + WebRTC — plain SIP is blocked by UAE
 * ISPs) and place the call themselves, so Asterisk never rings the recruiter
 * back. Click-to-call from the Chrome extension hands off to the web dialer
 * for the same reason. Asterisk forwards calls through the register trunk to
 * the on-premise UCM → Dinstar → SIM. Per-recruiter identity lives in the SIP
 * account; Asterisk always presents caller ID 1002 to the UCM (the only CID
 * its outbound route accepts).
 */
@Injectable()
export class AsteriskProvider implements CallingProviderStrategy {
  readonly key = CallingProvider.ASTERISK;

  private readonly webAppUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.webAppUrl = config.get<string>('WEB_APP_URL', 'http://localhost:3000');
  }

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

    // Browser, Chrome extension and API callers all hand off to the web
    // dialer, which registers the recruiter's own SIP account and invites the
    // candidate straight from the page. Asterisk never rings the recruiter
    // back — the softphone is the caller, matching the mobile app's behaviour.
    const sipUsername: string | undefined = input.user.providerConfig?.sipUsername;
    if (!sipUsername) {
      throw new BadRequestException(
        'No SIP line assigned. Ask an admin to set your SIP username in Users.',
      );
    }

    const dialUrl = `${this.webAppUrl}/dial?number=${encodeURIComponent(input.phoneNumber)}`;

    return {
      action: 'client_dial',
      provider: this.key,
      phoneNumber: input.phoneNumber,
      dialUrl,
      message: 'Dial from the SnappyConnect web dialer — it will call the candidate directly.',
    };
  }

  /**
   * SIP connection details for the built-in softphones.
   *
   * `wssUrl` is what the mobile app uses — it tolerates the self-signed
   * certificate on Asterisk's own port. Browsers do not, so `webWssUrl` points
   * at the nginx vhost that fronts the same service with a trusted
   * certificate. It falls back to `wssUrl` when unset.
   */
  async getClientConfig(user: User): Promise<{
    wssUrl: string;
    webWssUrl: string;
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
    return {
      wssUrl: cfg.wssUrl,
      webWssUrl: cfg.webWssUrl || cfg.wssUrl,
      sipDomain,
      sipUsername,
      sipPassword,
      displayName: user.name,
    };
  }
}
