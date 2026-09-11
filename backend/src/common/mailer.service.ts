import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Transactional email via Resend. Delivery failures are logged, never thrown:
 * callers (password reset) must behave identically whether or not the address
 * exists or the mail went out.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly apiKey: string;
  private readonly from: string;
  private readonly webAppUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY', '');
    this.from = config.get<string>(
      'MAIL_FROM',
      'SnappyConnect <onboarding@resend.dev>',
    );
    this.webAppUrl = config.get<string>('WEB_APP_URL', 'https://call.snappyhires.com');
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const link = `${this.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Reset your SnappyConnect password',
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Click below to choose a new password. The link works once and expires in an hour.</p>
       <p><a href="${link}">Reset your password</a></p>
       <p>If you didn't ask for this, ignore this email — your password stays as it is.</p>`,
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.error(`RESEND_API_KEY unset — cannot email ${to}`);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
      });
      if (!res.ok) {
        this.logger.error(`Resend rejected mail to ${to}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.error(`Mail to ${to} failed: ${(err as Error).message}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
