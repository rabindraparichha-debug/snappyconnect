/**
 * Run with `npm test` (tsc → node:test; no jest in this repo).
 * Covers the mobile app-return mode of "Continue with SnappyHires" and that
 * the web flow still ends on WEB_APP_URL/login#sso=.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { APP_CODE_TTL_MS, AppCodeStore, challengeFor } from './snappyhires-app-codes';
import { SnappyhiresSsoController } from './snappyhires-sso.controller';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // RFC 7636 appendix B

describe('AppCodeStore', () => {
  it('matches the RFC 7636 S256 vector', () => {
    assert.equal(challengeFor(VERIFIER), CHALLENGE);
  });

  it('returns the e-mail once for the right verifier', () => {
    const store = new AppCodeStore();
    const code = store.issue('a@b.co', CHALLENGE);
    assert.equal(store.take(code, VERIFIER), 'a@b.co');
    assert.equal(store.take(code, VERIFIER), null, 'single use');
  });

  it('burns the code on a wrong verifier', () => {
    const store = new AppCodeStore();
    const code = store.issue('a@b.co', CHALLENGE);
    assert.equal(store.take(code, 'x'.repeat(43)), null);
    assert.equal(store.take(code, VERIFIER), null);
  });

  it('expires after two minutes and sweeps old codes', () => {
    let t = 1_000;
    const store = new AppCodeStore(() => t);
    const code = store.issue('a@b.co', CHALLENGE);
    t += APP_CODE_TTL_MS;
    assert.equal(store.take(code, VERIFIER), null);
    store.issue('a@b.co', CHALLENGE);
    t += APP_CODE_TTL_MS + 1;
    store.issue('c@d.co', CHALLENGE);
    assert.equal(store.size, 1);
  });
});

// ---------------------------------------------------------------- controller

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeRes(): any {
  const res: any = {
    cookies: {},
    cleared: [],
    redirect(code: number, url: string) {
      res.statusCode = code;
      res.location = url;
    },
    cookie(name: string, value: string) {
      res.cookies[name] = value;
    },
    clearCookie(name: string) {
      res.cleared.push(name);
    },
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    json(b: unknown) {
      res.body = b;
    },
  };
  return res;
}

function fakeReq(cookie = ''): any {
  return { protocol: 'https', get: () => 'call.example.com', headers: { cookie } };
}

const ACTIVE = 'agent@example.com';
const authService: any = {
  calls: 0,
  async loginWithVerifiedEmail(email: string) {
    authService.calls++;
    return email === ACTIVE ? { accessToken: `jwt-for-${email}`, user: { email } } : null;
  },
};
const config: any = {
  get: (key: string, fallback?: string) =>
    ({ WEB_APP_URL: 'https://web.example.com' } as Record<string, string>)[key] ?? fallback,
};

const realFetch = globalThis.fetch;
function mockIssuer(email: string, verified = true) {
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'gotrue-at' }), { status: 200 });
    }
    return new Response(JSON.stringify({ email, email_verified: verified }), { status: 200 });
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function runToCallback(ctrl: SnappyhiresSsoController, appChallenge?: string) {
  const startRes = fakeRes();
  ctrl.start(fakeReq(), startRes as any, appChallenge);
  const state = new URL(startRes.location!).searchParams.get('state')!;
  const cookie = `sc_sso=${encodeURIComponent(startRes.cookies.sc_sso)}`;
  const cbRes = fakeRes();
  await ctrl.callback(fakeReq(cookie), cbRes as any, 'auth-code', state, undefined);
  return { startRes, cbRes };
}

describe('SnappyhiresSsoController', () => {
  it('web flow still hands the token to WEB_APP_URL in the fragment', async () => {
    mockIssuer(ACTIVE);
    const ctrl = new SnappyhiresSsoController(authService, config);
    const { startRes, cbRes } = await runToCallback(ctrl);
    assert.equal(startRes.cookies.sc_sso.split('.').length, 2);
    assert.equal(cbRes.location, `https://web.example.com/login#sso=${encodeURIComponent(`jwt-for-${ACTIVE}`)}`);
  });

  it('rejects a malformed app_challenge', () => {
    const ctrl = new SnappyhiresSsoController(authService, config);
    const res: any = fakeRes();
    ctrl.start(fakeReq(), res, 'not-a-challenge');
    assert.equal(res.statusCode, 400);
    assert.equal(res.location, undefined);
  });

  it('app mode: same OAuth redirect, ends on the app URL with a code, exchange returns the session', async () => {
    mockIssuer(ACTIVE);
    const ctrl = new SnappyhiresSsoController(authService, config);
    const { startRes, cbRes } = await runToCallback(ctrl, CHALLENGE);

    const authorize = new URL(startRes.location!);
    assert.equal(authorize.origin + authorize.pathname, 'https://accounts.snappyhires.com/oauth/authorize');
    assert.equal(
      authorize.searchParams.get('redirect_uri'),
      'https://call.example.com/api/v1/auth/snappyhires/callback',
    );

    const back = new URL(cbRes.location!);
    assert.equal(`${back.protocol}//${back.host}${back.pathname}`, 'snappyconnect://auth/snappyhires');
    assert.ok(!cbRes.location!.includes('jwt-for'), 'no token in the app redirect');
    const code = back.searchParams.get('code')!;

    await assert.rejects(ctrl.exchange({ code, verifier: 'y'.repeat(43) }), /expired/);
    // That wrong verifier burned the code; run again for the happy path.
    const again = await runToCallback(ctrl, CHALLENGE);
    const code2 = new URL(again.cbRes.location!).searchParams.get('code')!;
    const session = await ctrl.exchange({ code: code2, verifier: VERIFIER });
    assert.deepEqual(session, { accessToken: `jwt-for-${ACTIVE}`, user: { email: ACTIVE } });
    await assert.rejects(ctrl.exchange({ code: code2, verifier: VERIFIER }), /expired/);
  });

  it('app mode: unknown e-mail returns to the app with no_account', async () => {
    mockIssuer('stranger@example.com');
    const ctrl = new SnappyhiresSsoController(authService, config);
    const { cbRes } = await runToCallback(ctrl, CHALLENGE);
    assert.equal(cbRes.location, 'snappyconnect://auth/snappyhires?sso_error=no_account');
  });

  it('app mode: unverified e-mail and consent-cancel return to the app', async () => {
    mockIssuer(ACTIVE, false);
    const ctrl = new SnappyhiresSsoController(authService, config);
    const { cbRes } = await runToCallback(ctrl, CHALLENGE);
    assert.equal(cbRes.location, 'snappyconnect://auth/snappyhires?sso_error=unverified');

    const startRes = fakeRes();
    ctrl.start(fakeReq(), startRes as any, CHALLENGE);
    const state = new URL(startRes.location!).searchParams.get('state')!;
    const res = fakeRes();
    await ctrl.callback(
      fakeReq(`sc_sso=${encodeURIComponent(startRes.cookies.sc_sso)}`),
      res as any,
      undefined,
      state,
      'access_denied',
    );
    assert.equal(res.location, 'snappyconnect://auth/snappyhires?sso_error=cancelled');
  });

  it('exchange re-checks the account (deactivated after the callback → 403)', async () => {
    mockIssuer(ACTIVE);
    const ctrl = new SnappyhiresSsoController(authService, config);
    const { cbRes } = await runToCallback(ctrl, CHALLENGE);
    const code = new URL(cbRes.location!).searchParams.get('code')!;
    const original = authService.loginWithVerifiedEmail;
    authService.loginWithVerifiedEmail = async () => null;
    try {
      await assert.rejects(ctrl.exchange({ code, verifier: VERIFIER }), /Ask an admin/);
    } finally {
      authService.loginWithVerifiedEmail = original;
    }
  });
});
