import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallingProvider } from '../common/enums';
import { toUsE164 } from '../common/phone.util';
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
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
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

  /**
   * WebRTC sign-in material for the Telnyx JS/Flutter SDK.
   *
   * Telnyx only routes inbound calls to sessions logged in with a
   * connection's own SIP user_name/password — token sessions register but
   * inbound legs die with SIP 480, so a direct line never rings. The client
   * therefore signs in with the SIP identity of the user's own credential
   * connection (falling back to the shared WebRTC connection), and the token
   * is kept only for older clients that don't understand login/password.
   */
  async createWebRtcToken(
    user: User,
  ): Promise<{ token?: string; login?: string; password?: string; fromNumber?: string }> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (!cfg.apiKey) {
      throw new BadRequestException('Telnyx is not configured. Ask an admin to add credentials in Settings.');
    }

    const connectionId: string | undefined =
      user.providerConfig?.telnyxConnectionId || cfg.connectionId;
    if (!connectionId) {
      throw new BadRequestException(
        'No Telnyx Connection ID configured. Ask an admin to set the Connection ID in Settings.',
      );
    }

    const connRes = await fetch(`${TELNYX_API}/credential_connections/${connectionId}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!connRes.ok) {
      const body = await connRes.text();
      throw new BadRequestException(
        `Telnyx connection lookup failed (${connRes.status}): ${body}`,
      );
    }
    const conn: any = await connRes.json();
    const login: string | undefined = conn?.data?.user_name;
    const password: string | undefined = conn?.data?.password;
    if (!login || !password) {
      throw new BadRequestException('Telnyx connection has no SIP username/password.');
    }

    // Older mobile builds hard-require a token, so keep minting one for them
    // even though token sessions can only place calls, never receive them.
    let token: string | undefined;
    const credentialId: string | undefined =
      user.providerConfig?.telnyxCredentialId || cfg.credentialId;
    if (credentialId) {
      const res = await fetch(`${TELNYX_API}/telephony_credentials/${credentialId}/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (res.ok) token = (await res.text()).replace(/^"|"$/g, '');
    }

    // Callers must present one of the account's numbers as caller ID or
    // Telnyx rejects the outbound leg. Users may carry their own direct
    // number in providerConfig; otherwise the shared default applies.
    const fromNumber: string | undefined =
      user.providerConfig?.telnyxNumber || cfg.fromNumber;
    return { token, login, password, fromNumber };
  }

  /** Send an SMS via the Telnyx Messages API. Returns the provider message id. */
  async sendSms(to: string, body: string): Promise<{ externalId: string | null }> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (!cfg.apiKey || !cfg.fromNumber) {
      throw new BadRequestException(
        'Telnyx SMS is not configured (apiKey and fromNumber are required).',
      );
    }

    // The admin-configured from number may be stored without +1; Telnyx
    // rejects either side when it's not E.164.
    const payload: Record<string, any> = {
      from: toUsE164(String(cfg.fromNumber), 'sending number (Settings → Telnyx "From number")'),
      to: toUsE164(to),
      text: body,
    };
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
