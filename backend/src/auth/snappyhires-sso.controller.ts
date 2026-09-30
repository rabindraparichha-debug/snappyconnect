import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';

/**
 * "Continue with SnappyHires" — the shared SnappyHires account (GoTrue OAuth
 * 2.1 server, front door accounts.snappyhires.com). Public PKCE client, no
 * secret. SnappyConnect stays invite-only: the verified e-mail must already
 * belong to an active SnappyConnect user; nobody is ever created here. The
 * person then gets the very same JWT a password login issues, so roles and
 * every guard keep working unchanged.
 */
const COOKIE = 'sc_sso';
const COOKIE_PATH = '/api/v1/auth/snappyhires';

@ApiExcludeController()
@Controller('auth/snappyhires')
export class SnappyhiresSsoController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  private get issuer(): string {
    return this.config
      .get<string>('SNAPPYHIRES_OAUTH_ISSUER', 'https://accounts.snappyhires.com')
      .replace(/\/$/, '');
  }

  private get clientId(): string {
    // Public client id (not a secret), registered on GoTrue as "SnappyConnect".
    return this.config.get<string>(
      'SNAPPYHIRES_OAUTH_CLIENT_ID',
      'ae043367-e7e8-471c-bc9c-fdac1db25fe4',
    );
  }

  private get webUrl(): string {
    return this.config.get<string>('WEB_APP_URL', 'http://localhost:3000').replace(/\/$/, '');
  }

  private redirectUri(req: Request): string {
    const explicit = this.config.get<string>('SNAPPYHIRES_OAUTH_REDIRECT');
    if (explicit) return explicit;
    const api = this.config.get<string>('PUBLIC_API_URL');
    if (api) return `${api.replace(/\/$/, '')}/auth/snappyhires/callback`;
    return `${req.protocol}://${req.get('host')}/api/v1/auth/snappyhires/callback`;
  }

  private fail(res: Response, reason: string) {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    res.redirect(302, `${this.webUrl}/login?sso_error=${encodeURIComponent(reason)}`);
  }

  @Public()
  @Get('start')
  start(@Req() req: Request, @Res() res: Response) {
    if (!this.clientId) return this.fail(res, 'disabled');
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const url = new URL(`${this.issuer}/oauth/authorize`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(req));
    url.searchParams.set('response_type', 'code');
    // No openid: the shared login cannot hand ID tokens to browsers yet.
    url.searchParams.set('scope', 'email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    res.cookie(COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: this.redirectUri(req).startsWith('https://'),
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: 600_000,
    });
    res.redirect(302, url.toString());
  }

  @Public()
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') returnedState?: string,
    @Query('error') error?: string,
  ) {
    const [state, verifier] = readCookie(req, COOKIE).split('.');
    if (!state || !verifier) return this.fail(res, 'expired');
    if (error) return this.fail(res, 'cancelled');
    if (!code || returnedState !== state) return this.fail(res, 'failed');

    let accessToken = '';
    try {
      const tokenRes = await fetch(`${this.issuer}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri(req),
          client_id: this.clientId,
          code_verifier: verifier,
        }),
      });
      const json = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
      accessToken = json.access_token ?? '';
      if (!tokenRes.ok || !accessToken) return this.fail(res, 'failed');
    } catch {
      return this.fail(res, 'failed');
    }

    let info: { email?: string; email_verified?: boolean };
    try {
      const infoRes = await fetch(`${this.issuer}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) return this.fail(res, 'failed');
      info = (await infoRes.json()) as typeof info;
    } catch {
      return this.fail(res, 'failed');
    }
    const email = (info.email ?? '').trim().toLowerCase();
    if (!email || info.email_verified !== true) return this.fail(res, 'unverified');

    const session = await this.authService.loginWithVerifiedEmail(email);
    if (!session) return this.fail(res, 'no_account');

    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    // Fragment, not query: the token never reaches server or proxy logs.
    res.redirect(302, `${this.webUrl}/login#sso=${encodeURIComponent(session.accessToken)}`);
  }
}

function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
