import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

const TELNYX_API = 'https://api.telnyx.com/v2';

/**
 * Thin wrapper over the Telnyx REST API for the pieces SnappyConnect
 * provisions itself: per-recruiter SIP lines (a credential connection plus a
 * number pinned to it) and Call Control commands for the board line's IVR.
 *
 * Inbound calls only reach a browser when the number is attached to the
 * connection that mints that user's WebRTC token — one connection per
 * recruiter is what makes a direct line actually ring.
 */
@Injectable()
export class TelnyxApiService {
  private readonly logger = new Logger(TelnyxApiService.name);

  constructor(private readonly settings: SettingsService) {}

  private async apiKey(): Promise<string> {
    const cfg = await this.settings.getProviderSettings('telnyx');
    if (!cfg.apiKey) {
      throw new BadRequestException('Telnyx is not configured. Add an API key in Settings.');
    }
    return cfg.apiKey;
  }

  async request<T = any>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const key = await this.apiKey();
    const res = await fetch(`${TELNYX_API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(`Telnyx ${init.method ?? 'GET'} ${path} failed (${res.status}): ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ----- Provisioning (per-recruiter direct lines) -----

  /** Credential connection dedicated to one user, so their number can ring them. */
  async createCredentialConnection(name: string): Promise<{ id: string }> {
    const data = await this.request<any>('/credential_connections', {
      method: 'POST',
      body: {
        connection_name: name,
        user_name: `sc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        password: this.randomSecret(),
        // Browsers register over WSS; encrypted media keeps Chrome happy.
        webhook_event_url: undefined,
      },
    });
    return { id: String(data?.data?.id) };
  }

  async createTelephonyCredential(connectionId: string, name: string): Promise<{ id: string }> {
    const data = await this.request<any>('/telephony_credentials', {
      method: 'POST',
      body: { connection_id: connectionId, name },
    });
    return { id: String(data?.data?.id) };
  }

  /** Point a number at a connection (or Call Control app) so inbound calls route there. */
  async assignNumberToConnection(phoneNumber: string, connectionId: string): Promise<void> {
    const list = await this.request<any>(
      `/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
    );
    const id = list?.data?.[0]?.id;
    if (!id) throw new BadRequestException(`Number ${phoneNumber} is not on this Telnyx account.`);
    await this.request(`/phone_numbers/${id}`, {
      method: 'PATCH',
      body: { connection_id: connectionId },
    });
  }

  async listNumbers(): Promise<Array<{ phoneNumber: string; connectionId: string | null }>> {
    const data = await this.request<any>('/phone_numbers?page[size]=100');
    return (data?.data ?? []).map((n: any) => ({
      phoneNumber: n.phone_number,
      connectionId: n.connection_id ?? null,
    }));
  }

  /** Buy the first available US local number in the given area code. */
  async purchaseNumber(areaCode: string): Promise<string> {
    const search = await this.request<any>(
      `/available_phone_numbers?filter[country_code]=US&filter[national_destination_code]=${areaCode}` +
        '&filter[features][]=sms&filter[features][]=voice&filter[limit]=1',
    );
    const number = search?.data?.[0]?.phone_number;
    if (!number) throw new BadRequestException(`No numbers available in area code ${areaCode}.`);
    await this.request('/number_orders', {
      method: 'POST',
      body: { phone_numbers: [{ phone_number: number }] },
    });
    return number;
  }

  // ----- Call Control (board line IVR) -----

  async answerCall(callControlId: string): Promise<void> {
    await this.command(callControlId, 'answer', {});
  }

  async speak(callControlId: string, payload: string): Promise<void> {
    await this.command(callControlId, 'speak', {
      payload,
      voice: 'female',
      language: 'en-US',
    });
  }

  /** Play a prompt and collect a single digit. */
  async gatherDigits(callControlId: string, prompt: string, validDigits: string): Promise<void> {
    await this.command(callControlId, 'gather_using_speak', {
      payload: prompt,
      voice: 'female',
      language: 'en-US',
      valid_digits: validDigits,
      maximum_digits: 1,
      timeout_millis: 8000,
    });
  }

  /** Bridge the caller to a SIP user (recruiter's browser) or a phone number. */
  async transfer(callControlId: string, to: string, from?: string): Promise<void> {
    await this.command(callControlId, 'transfer', {
      to,
      from,
      timeout_secs: 30,
    });
  }

  async hangup(callControlId: string): Promise<void> {
    await this.command(callControlId, 'hangup', {});
  }

  private async command(callControlId: string, action: string, body: Record<string, unknown>) {
    try {
      await this.request(`/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
        method: 'POST',
        body,
      });
    } catch (err) {
      // A caller who hangs up mid-command makes these 404/422 — noisy, not fatal.
      this.logger.warn(`Call Control ${action} failed: ${(err as Error).message}`);
    }
  }

  private randomSecret(): string {
    return Array.from({ length: 24 }, () =>
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join('');
  }
}
