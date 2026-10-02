/**
 * Run with `npm test` (tsc → node:test; no jest in this repo).
 * Covers GET /universe/people: the universe service token, the 422/503
 * answers, and that the card never carries recordings, transcripts, notes or
 * anybody else's full phone number.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import {
  CarePeopleService,
  formatDuration,
  maskPhone,
  phoneVariants,
} from './care-people.service';
import { UniversePeopleController } from './universe-people.controller';
import { verifyUniverseServiceToken } from './universe-token';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SECRET = 'test-universe-secret-at-least-32-chars-long';
const NOW = new Date('2026-10-02T12:00:00Z');

function sign(claims: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
const good = (over: Record<string, unknown> = {}) => ({
  aud: 'authenticated',
  role: 'service',
  app_metadata: { app: 'ats' },
  exp: Math.floor(Date.now() / 1000) + 300,
  ...over,
});

describe('verifyUniverseServiceToken', () => {
  it('accepts ats and support, with or without exp', () => {
    assert.deepEqual(verifyUniverseServiceToken(sign(good()), SECRET), { ok: true, app: 'ats' });
    assert.deepEqual(
      verifyUniverseServiceToken(sign(good({ app_metadata: { app: 'support' }, exp: undefined })), SECRET),
      { ok: true, app: 'support' },
    );
  });

  it('rejects a bad signature, a tampered payload and a foreign algorithm', () => {
    assert.equal(verifyUniverseServiceToken(sign(good(), 'another-secret'), SECRET).ok, false);
    const [h, , s] = sign(good()).split('.');
    const forged = Buffer.from(JSON.stringify(good({ exp: 9_999_999_999 }))).toString('base64url');
    assert.equal(verifyUniverseServiceToken(`${h}.${forged}.${s}`, SECRET).ok, false);
    assert.equal(verifyUniverseServiceToken(sign(good(), SECRET, 'none'), SECRET).ok, false);
    assert.equal(verifyUniverseServiceToken('not-a-jwt', SECRET).ok, false);
  });

  it('rejects the wrong role, audience and a disallowed app', () => {
    assert.equal(verifyUniverseServiceToken(sign(good({ role: 'authenticated' })), SECRET).ok, false);
    assert.equal(verifyUniverseServiceToken(sign(good({ aud: 'anon' })), SECRET).ok, false);
    assert.equal(verifyUniverseServiceToken(sign(good({ app_metadata: { app: 'crm' } })), SECRET).ok, false);
    assert.equal(verifyUniverseServiceToken(sign(good({ app_metadata: undefined })), SECRET).ok, false);
  });

  it('rejects an expired token', () => {
    const res = verifyUniverseServiceToken(sign(good({ exp: Math.floor(Date.now() / 1000) - 5 })), SECRET);
    assert.deepEqual(res, { ok: false, reason: 'expired' });
  });
});

describe('phone helpers', () => {
  it('masks all but the last four digits', () => {
    assert.equal(maskPhone('+1 (630) 555-1234'), '+•••••1234');
    assert.equal(maskPhone(''), '+•••••');
  });
  it('spells one number every way it may be stored', () => {
    const v = phoneVariants('(630) 555-1234');
    for (const want of ['6305551234', '+16305551234', '16305551234']) assert.ok(v.includes(want), want);
    assert.ok(phoneVariants('+971 50 123 4567').includes('+971501234567'));
    assert.deepEqual(phoneVariants('12'), []);
  });
  it('formats durations', () => {
    assert.equal(formatDuration(192), '3m12s');
    assert.equal(formatDuration(7), '7s');
    assert.equal(formatDuration(3720), '1h02m');
  });
});

// ------------------------------------------------------------------ fixtures

const AGENT = {
  id: 'u-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  mobileNumber: '+919800000001',
  role: 'user',
  status: 'active',
  provider: 'telnyx',
  regions: ['usa'],
  createdAt: new Date('2026-01-05T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};
const CUSTOMER = '+16305551234';
function call(over: Record<string, unknown>): any {
  return {
    id: 'c',
    userId: AGENT.id,
    user: AGENT,
    phoneNumber: CUSTOMER,
    direction: 'inbound',
    status: 'completed',
    durationSeconds: 192,
    startedAt: new Date('2026-09-30T10:00:00Z'),
    createdAt: new Date('2026-09-30T10:00:00Z'),
    disposition: null,
    contactName: 'Private Person',
    recordingUrl: 'https://recordings.example.com/secret.mp3',
    notes: 'private note text',
    transcript: 'private transcript text',
    aiSummary: 'private ai summary',
    metadata: { from: '+15550009999' },
    ...over,
  };
}
const CALLS = [
  call({ id: 'c1' }),
  call({ id: 'c2', direction: 'outbound', status: 'no_answer', durationSeconds: 0,
    startedAt: new Date('2026-09-20T09:00:00Z'), createdAt: new Date('2026-09-20T09:00:00Z') }),
  call({ id: 'c3', phoneNumber: '+14155550777', direction: 'outbound', disposition: 'left_voicemail',
    startedAt: new Date('2026-09-10T09:00:00Z'), createdAt: new Date('2026-09-10T09:00:00Z') }),
  call({ id: 'c4', startedAt: null, createdAt: new Date('2026-01-10T09:00:00Z') }), // outside 90 days
];

/** Just enough of a TypeORM repository: equality, In() and MoreThanOrEqual(). */
function matches(row: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && 'type' in cond) {
      if (cond.type === 'in') return cond.value.includes(row[key]);
      if (cond.type === 'moreThanOrEqual') return row[key] >= cond.value;
      throw new Error(`unsupported operator ${cond.type}`);
    }
    return row[key] === cond;
  });
}
function fakeRepo(rows: any[]): any {
  return {
    async find({ where, take }: any) {
      return rows
        .filter((r) => matches(r, where))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, take ?? rows.length);
    },
    async findOne({ where }: any) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async count({ where }: any) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}
function makeService(opts: { blocked?: string[]; voicemails?: any[] } = {}) {
  const config: any = {
    get: (key: string, fallback?: string) =>
      ({ WEB_APP_URL: 'https://call.example.com/' } as Record<string, string>)[key] ?? fallback,
  };
  const dnc: any = { isBlocked: (n: string) => (opts.blocked ?? []).includes(n) };
  return new CarePeopleService(
    fakeRepo(CALLS),
    fakeRepo([AGENT]),
    fakeRepo(opts.voicemails ?? []),
    dnc,
    config,
  );
}
function makeController(secret: string | undefined, service = makeService()) {
  const config: any = { get: (key: string) => (key === 'UNIVERSE_JWT_SECRET' ? secret : undefined) };
  const ctrl = new UniversePeopleController(service, config);
  const original = service.lookup.bind(service);
  service.lookup = (q) => original(q, NOW);
  return ctrl;
}
async function status(p: Promise<unknown>): Promise<{ code: number; body: any }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { code: e.getStatus(), body: e.getResponse() };
    throw e;
  }
  return { code: 200, body: null };
}
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------- controller

describe('GET /universe/people', () => {
  const bearer = (claims = good()) => `Bearer ${sign(claims)}`;

  it('503 {error:"not configured"} when the secret is unset — even with a token', async () => {
    for (const secret of [undefined, '', '   ']) {
      const res = await status(makeController(secret).lookup(bearer(), undefined, 'a@b.co'));
      assert.equal(res.code, 503);
      assert.deepEqual(res.body, { error: 'not configured' });
    }
  });

  it('401 for a missing, malformed, badly signed, wrong-role, disallowed-app or expired token', async () => {
    const ctrl = makeController(SECRET);
    const bad = [
      undefined,
      'Bearer',
      `Basic ${sign(good())}`,
      `Bearer ${sign(good(), 'another-secret')}`,
      bearer(good({ role: 'authenticated' })),
      bearer(good({ app_metadata: { app: 'staffio' } })),
      bearer(good({ exp: Math.floor(Date.now() / 1000) - 1 })),
    ];
    for (const header of bad) {
      const res = await status(ctrl.lookup(header, undefined, 'asha@example.com'));
      assert.equal(res.code, 401, String(header));
    }
  });

  it('422 without a usable identifier', async () => {
    const ctrl = makeController(SECRET);
    assert.equal((await status(ctrl.lookup(bearer()))).code, 422);
    assert.equal((await status(ctrl.lookup(bearer(), '', ' ', ''))).code, 422);
    assert.equal((await status(ctrl.lookup(bearer(), undefined, 'not-an-email', '12'))).code, 422);
    assert.equal((await status(ctrl.lookup(bearer(), ['a', 'b'] as any))).code, 422);
  });

  it('found:false with empty arrays for an unknown person', async () => {
    const ctrl = makeController(SECRET);
    const expected = {
      found: false,
      product: 'snappyconnect',
      roles: [],
      summary: '',
      last_activity_at: null,
      flags: {},
      facts: [],
      links: [],
    };
    assert.deepEqual(await ctrl.lookup(bearer(), undefined, 'nobody@example.com', '+12025550000'), expected);
    // Users carry no universe id, so it alone finds nobody.
    assert.deepEqual(await ctrl.lookup(bearer(), '5b1c0c1e-0000-4000-8000-000000000000'), expected);
  });

  it('phone match: recent calls, 90-day summary, agent by display name only', async () => {
    const ctrl = makeController(
      SECRET,
      makeService({ blocked: [CUSTOMER], voicemails: [{ fromNumber: CUSTOMER, createdAt: NOW }] }),
    );
    const card = await ctrl.lookup(bearer(good({ app_metadata: { app: 'support' } })), undefined, undefined, '(630) 555-1234');
    assert.equal(card.found, true);
    assert.equal(card.product, 'snappyconnect');
    assert.deepEqual(card.roles, ['caller']);
    assert.equal(card.summary, '2 calls in the last 90 days, last on 2026-09-30. On the Do Not Call list');
    assert.equal(card.last_activity_at, '2026-09-30T10:00:00.000Z');
    assert.deepEqual(card.flags, { do_not_call: true, has_voicemail: true });
    assert.equal(card.facts.length, 3);
    assert.deepEqual(card.facts[0], {
      label: 'Call',
      value: '2026-09-30 inbound · 3m12s · completed · handled by Asha Rao',
    });
    assert.equal(card.facts[1].value, '2026-09-20 outbound · 0s · no answer · handled by Asha Rao');
    assert.deepEqual(card.links, [{ label: 'SnappyConnect call history', url: 'https://call.example.com/history' }]);

    const text = JSON.stringify(card);
    assert.ok(!text.includes(AGENT.email), 'no agent e-mail');
    assert.ok(!text.includes('9800000001'), 'no agent number');
    assert.ok(!text.includes('6305551234'), 'the looked-up number is not echoed, in a link or anywhere');
  });

  it('agent match: role, account facts, and the other parties masked as +•••••1234', async () => {
    const ctrl = makeController(SECRET);
    const card = await ctrl.lookup(bearer(), undefined, 'Asha@Example.com');
    assert.deepEqual(card.roles, ['agent']);
    assert.deepEqual(card.flags, { account_active: true, calling_enabled: true });
    assert.match(card.summary, /^SnappyConnect agent \(active\), 3 calls handled in the last 90 days, last on 2026-09-30$/);
    assert.deepEqual(card.facts[0], { label: 'Account', value: 'agent · active' });

    const callFacts = card.facts.filter((f) => f.label === 'Call');
    assert.equal(callFacts.length, 4);
    assert.equal(callFacts[0].value, '2026-09-30 inbound · 3m12s · completed · with +•••••1234');
    assert.equal(callFacts[2].value, '2026-09-10 outbound · 3m12s · left voicemail · with +•••••0777');
    const text = JSON.stringify(card);
    for (const full of ['16305551234', '6305551234', '14155550777', '15550009999']) {
      assert.ok(!text.includes(full), `full number ${full} must not appear`);
    }
    // Looked up by the agent's own mobile: same account, still nobody's full number.
    const byPhone = await ctrl.lookup(bearer(), undefined, undefined, AGENT.mobileNumber);
    assert.deepEqual(byPhone.roles, ['agent']);
    assert.ok(!JSON.stringify(byPhone).includes('6305551234'));
  });

  it('never returns recordings, transcripts, notes or their contents; caps facts and strings', async () => {
    const ctrl = makeController(SECRET);
    for (const card of [
      await ctrl.lookup(bearer(), undefined, undefined, CUSTOMER),
      await ctrl.lookup(bearer(), undefined, AGENT.email, CUSTOMER),
    ]) {
      for (const key of allKeys(card)) assert.doesNotMatch(key, /recording|transcript|note/i);
      const text = JSON.stringify(card);
      for (const secret of ['secret.mp3', 'private note', 'private transcript', 'private ai summary', 'Private Person']) {
        assert.ok(!text.includes(secret), secret);
      }
      assert.ok(card.facts.length <= 12);
      assert.ok(card.summary.length <= 200);
      for (const f of card.facts) assert.ok(f.label.length <= 200 && f.value.length <= 200);
    }
    const both = await ctrl.lookup(bearer(), undefined, AGENT.email, CUSTOMER);
    assert.deepEqual(both.roles, ['agent', 'caller']);
  });
});
