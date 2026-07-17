import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallingProvider } from '../common/enums';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/user.entity';
import {
  CallingProviderStrategy,
  InitiateCallInput,
  InitiateCallResult,
} from './provider.interface';

const TELNYX_API = 'https://api.telnyx.com/v2';

/**
 * Telnyx (USA). Web/mobile clients dial through the Telnyx WebRTC SDK using a
 * short-lived token issued here; SMS goes through the Telnyx Messages API.
 */
@Injectable()
export class TelnyxProvider implements CallingProviderStrategy {
  readonly key = CallingProvider.TELNYX;

  private readonly webAppUrl: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.webAppUrl = config.get<string>('WEB_APP_URL', 'http://localhost:3000');
  }

  async initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
    // Telnyx calls are placed by the client (browser / mobile app) over WebRTC.
    // The API's job is to tell the caller where to dial from.
    return {
      action: 'client_dial',
      provider: this.key,
      phoneNumber: input.phoneNumber,
      dialUrl: `${this.webAppUrl}/dial?number=${encodeURIComponent(input.phoneNumber)}`,
      message: 'Dial from the SnappyConnect web or mobile dialer (Telnyx WebRTC).',
    };
  }

  /** Issue a short-lived WebRTC token for the Telnyx JS/Flutter SDK. */
  async createWebRtcToken(user: User): Promise<{ token: string }> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (!cfg.apiKey) {
      throw new BadRequestException('Telnyx is not configured. Ask an admin to add credentials in Settings.');
    }
    const credentialId: string | undefined =
      user.providerConfig?.telnyxCredentialId || cfg.credentialId;
    if (!credentialId) {
      throw new BadRequestException(
        'No Telnyx telephony credential assigned to this user or configured globally.',
      );
    }

    const res = await fetch(`${TELNYX_API}/telephony_credentials/${credentialId}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(`Telnyx token request failed (${res.status}): ${body}`);
    }
    const token = await res.text();
    return { token: token.replace(/^"|"$/g, '') };
  }

  /** Send an SMS via the Telnyx Messages API. Returns the provider message id. */
  async sendSms(to: string, body: string): Promise<{ externalId: string | null }> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (!cfg.apiKey || !cfg.fromNumber) {
      throw new BadRequestException(
        'Telnyx SMS is not configured (apiKey and fromNumber are required).',
      );
    }

    const payload: Record<string, any> = { from: cfg.fromNumber, to, text: body };
    if (cfg.messagingProfileId) payload.messaging_profile_id = cfg.messagingProfileId;

    const res = await fetch(`${TELNYX_API}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(`Telnyx SMS failed (${res.status}): ${text}`);
    }
    const data: any = await res.json();
    return { externalId: data?.data?.id ?? null };
  }
}
