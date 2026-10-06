import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Transactional email via SMTP (Amazon SES). Delivery failures are logged,
 * never thrown: callers (password reset) must behave identically whether or
 * not the address exists or the mail went out.
 *
 * Configure via env: SMTP_HOST=email-smtp.<region>.amazonaws.com, SMTP_PORT=587,
 * SMTP_USER=<SES SMTP username>, SMTP_PASS=<SES SMTP password>,
 * SMTP_SECURE=false (STARTTLS on 587; set true only for port 465). When
 * SMTP_HOST is unset the mailer stays disabled and logs instead of sending.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly webAppUrl: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST', '');
    this.from = config.get<string>(
      'MAIL_FROM',
      'SnappyConnect <noreply@snappyhires.com>',
    );
    this.webAppUrl = config.get<string>('WEB_APP_URL', 'https://call.snappyhires.com');
    const port = Number(config.get<string>('SMTP_PORT', '587'));
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port,
          secure: config.get<string>('SMTP_SECURE', 'false') === 'true' || port === 465,
          auth: {
            user: config.get<string>('SMTP_USER', ''),
            pass: config.get<string>('SMTP_PASS', ''),
          },
        })
      : null;
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
    if (!this.transporter) {
      this.logger.error(`SMTP_HOST unset — cannot email ${to}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
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
