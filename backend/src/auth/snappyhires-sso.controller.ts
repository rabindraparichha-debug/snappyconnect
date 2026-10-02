import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { SnappyhiresExchangeDto } from './dto/snappyhires-exchange.dto';
import { APP_CHALLENGE_RE, AppCodeStore } from './snappyhires-app-codes';

/**
 * "Continue with SnappyHires" — the shared SnappyHires account (GoTrue OAuth
 * 2.1 server, front door accounts.snappyhires.com). Public PKCE client, no
 * secret. SnappyConnect stays invite-only: the verified e-mail must already
 * belong to an active SnappyConnect user; nobody is ever created here. The
 * person then gets the very same JWT a password login issues, so roles and
 * every guard keep working unchanged.
 *
 * App-return mode (the SnappyConnect mobile app). The app opens
 * /start?app_challenge=<base64url SHA-256 of a secret it keeps> in a system
 * auth session (ASWebAuthenticationSession / Custom Tabs). The OAuth leg is
 * the same — same client, same registered redirect URI — but the callback
 * ends on a FIXED app URL (SNAPPYHIRES_APP_RETURN_URL, default
 * snappyconnect://auth/snappyhires) with a two-minute, single-use code that
 * carries no token. The app then POSTs {code, verifier} to /exchange and gets
 * exactly what POST /auth/login returns. Another app claiming the scheme can
 * catch the code but cannot use it without the verifier. The web flow is
 * unchanged.
 */
const COOKIE = 'sc_sso';
const COOKIE_PATH = '/api/v1/auth/snappyhires';

@ApiExcludeController()
@Controller('auth/snappyhires')
export class SnappyhiresSsoController {
  /** One process, so in memory — see snappyhires-app-codes.ts. */
  private readonly appCodes = new AppCodeStore();

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

  /** Fixed custom-scheme target for the mobile app — never taken from the request. */
  private get appReturnUrl(): string {
    return this.config.get<string>('SNAPPYHIRES_APP_RETURN_URL', 'snappyconnect://auth/snappyhires');
  }

  private fail(res: Response, reason: string, app?: string) {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    const target = app ? this.appReturnUrl : `${this.webUrl}/login`;
    res.redirect(302, `${target}?sso_error=${encodeURIComponent(reason)}`);
  }

  @Public()
  @Get('start')
  start(
    @Req() req: Request,
    @Res() res: Response,
    @Query('app_challenge') appChallenge?: string,
  ) {
    const app = appChallenge ?? '';
    if (app && !APP_CHALLENGE_RE.test(app)) {
      res.status(400).json({ statusCode: 400, message: 'Invalid app_challenge' });
      return;
    }
    if (!this.clientId) return this.fail(res, 'disabled', app);
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

    // base64url never contains '.', so the parts split back cleanly. The app
    // challenge rides in the same httpOnly cookie as state and verifier.
    res.cookie(COOKIE, [state, verifier, app].filter(Boolean).join('.'), {
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
    const [state, verifier, app] = readCookie(req, COOKIE).split('.');
    // No cookie means we cannot tell web from app; the web login explains it.
    if (!state || !verifier) return this.fail(res, 'expired');
    if (error) return this.fail(res, 'cancelled', app);
    if (!code || returnedState !== state) return this.fail(res, 'failed', app);

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
      if (!tokenRes.ok || !accessToken) return this.fail(res, 'failed', app);
    } catch {
      return this.fail(res, 'failed', app);
    }

    let info: { email?: string; email_verified?: boolean };
    try {
      const infoRes = await fetch(`${this.issuer}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) return this.fail(res, 'failed', app);
      info = (await infoRes.json()) as typeof info;
    } catch {
      return this.fail(res, 'failed', app);
    }
    const email = (info.email ?? '').trim().toLowerCase();
    if (!email || info.email_verified !== true) return this.fail(res, 'unverified', app);

    let session: Awaited<ReturnType<AuthService['loginWithVerifiedEmail']>>;
    try {
      session = await this.authService.loginWithVerifiedEmail(email);
    } catch {
      return this.fail(res, 'failed', app);
    }
    if (!session) return this.fail(res, 'no_account', app);

    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    if (app) {
      // No token leaves here: the app swaps this code (plus its verifier) for
      // one at /exchange, which re-checks the account at that moment.
      const appCode = this.appCodes.issue(email, app);
      return res.redirect(302, `${this.appReturnUrl}?code=${encodeURIComponent(appCode)}`);
    }
    // Fragment, not query: the token never reaches server or proxy logs.
    res.redirect(302, `${this.webUrl}/login#sso=${encodeURIComponent(session.accessToken)}`);
  }

  /**
   * POST /auth/snappyhires/exchange {code, verifier} — the mobile app's
   * second leg. Returns exactly what POST /auth/login returns. Errors are
   * 400/403, never 401, so the app does not mistake them for an expired
   * session.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() dto: SnappyhiresExchangeDto) {
    const email = this.appCodes.take(dto.code, dto.verifier);
    if (!email) {
      throw new BadRequestException('That sign-in has expired. Please try again.');
    }
    // Issued now, through the same path as the web flow, so the token's
    // claims are defined in one place (AuthService.issueSession).
    const session = await this.authService.loginWithVerifiedEmail(email);
    if (!session) {
      throw new ForbiddenException(
        'No active SnappyConnect account uses that SnappyHires email. Ask an admin for access.',
      );
    }
    return session;
  }
}

function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}
