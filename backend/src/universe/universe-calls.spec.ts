/**
 * Run with `npm test` (tsc → node:test; no jest in this repo).
 * Covers GET /universe/calls: the universe service token, the 422/503
 * answers, microsecond keyset cursors, exact hasMore, and that the feed never
 * carries a phone number, contact name, notes, transcript or recording.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import {
  buildPage,
  clampLimit,
  decodeCursor,
  encodeCursor,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  FeedRow,
  toFeedCall,
} from './universe-calls';
import { UniverseCallsController } from './universe-calls.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SECRET = 'test-universe-secret-at-least-32-chars-long';

function sign(claims: Record<string, unknown>, secret = SECRET): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
const goodToken = () =>
  sign({
    role: 'service',
    aud: 'authenticated',
    app_metadata: { app: 'ats' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function row(id: string, cursorTs: string, extra: Partial<FeedRow> = {}): FeedRow {
  return {
    id,
    userId: 'u1',
    userName: 'Rabindra',
    userEmail: 'Rab@Example.com',
    direction: 'outbound',
    status: 'completed',
    disposition: null,
    durationSeconds: '125',
    ringTimeSeconds: 7,
    region: 'india',
    source: 'web',
    startedAt: new Date('2026-10-01T10:00:00Z'),
    endedAt: null,
    cursorTs,
    ...extra,
  };
}

function controller(rows: FeedRow[], secret: string | undefined = SECRET) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const repo = {
    query: async (sql: string, params: unknown[]) => {
      seen.push({ sql, params });
      return rows;
    },
  };
  const config = { get: () => secret };
  return { c: new UniverseCallsController(repo as any, config as any), seen };
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : 500;
  }
}

describe('universe calls cursor', () => {
  it('round-trips and keeps microseconds', () => {
    const c = { t: '2026-10-01T10:00:00.123456Z', i: ID_A };
    assert.deepEqual(decodeCursor(encodeCursor(c)), c);
  });
  it('rejects millisecond timestamps, junk and bad ids', () => {
    assert.equal(decodeCursor(encodeCursor({ t: '2026-10-01T10:00:00.123Z', i: ID_A })), null);
    assert.equal(decodeCursor(encodeCursor({ t: '2026-10-01T10:00:00.123456Z', i: 'nope' })), null);
    assert.equal(decodeCursor('not-base64-json'), null);
    assert.equal(decodeCursor(42), null);
  });
  it('clamps the page size', () => {
    assert.equal(clampLimit(undefined), FEED_DEFAULT_LIMIT);
    assert.equal(clampLimit('0'), FEED_DEFAULT_LIMIT);
    assert.equal(clampLimit('9999'), FEED_MAX_LIMIT);
    assert.equal(clampLimit('50'), 50);
  });
});

describe('universe calls page', () => {
  it('hasMore is exact and the cursor is the last row on the page', () => {
    const rows = [
      row(ID_A, '2026-10-01T10:00:00.000001Z'),
      row(ID_B, '2026-10-01T10:00:00.000002Z'),
    ];
    const one = buildPage(rows, 1);
    assert.equal(one.hasMore, true);
    assert.equal(one.calls.length, 1);
    assert.deepEqual(decodeCursor(one.nextCursor), { t: '2026-10-01T10:00:00.000001Z', i: ID_A });
    const all = buildPage(rows, 2);
    assert.equal(all.hasMore, false);
    assert.equal(buildPage([], 5).nextCursor, null);
  });
  it('maps numbers, lower-cases the email and carries no contact fields', () => {
    const call = toFeedCall(
      row(ID_A, '2026-10-01T10:00:00.000001Z', {
        // Fields that must never cross even if a future query selects them.
        ...({ phoneNumber: '+15550001111', contactName: 'Jane', notes: 'x', transcript: 't', recordingUrl: 'r' } as any),
      }),
    );
    assert.equal(call.durationSeconds, 125);
    assert.equal(call.userEmail, 'rab@example.com');
    assert.equal(call.startedAt, '2026-10-01T10:00:00.000Z');
    for (const k of ['phoneNumber', 'contactName', 'notes', 'transcript', 'recordingUrl']) {
      assert.equal(k in call, false, `${k} must not be on the feed`);
    }
  });
});

describe('GET /universe/calls', () => {
  it('503 when the secret is not configured', async () => {
    const { c } = controller([], '');
    assert.equal(await status(c.feed(`Bearer ${goodToken()}`)), 503);
  });
  it('401 without, or with a forged, token', async () => {
    const { c, seen } = controller([]);
    assert.equal(await status(c.feed(undefined)), 401);
    assert.equal(await status(c.feed(`Bearer ${sign({ role: 'service', app_metadata: { app: 'ats' } }, 'wrong-secret-wrong-secret-wrong')}`)), 401);
    assert.equal(seen.length, 0, 'no query before the token is accepted');
  });
  it('422 on a malformed cursor', async () => {
    const { c } = controller([]);
    assert.equal(await status(c.feed(`Bearer ${goodToken()}`, 'garbage')), 422);
  });
  it('first page passes null cursor and asks for limit + 1', async () => {
    const { c, seen } = controller([row(ID_A, '2026-10-01T10:00:00.000001Z')]);
    const page = await c.feed(`Bearer ${goodToken()}`, undefined, '10');
    assert.deepEqual(seen[0].params, [null, null, 11]);
    assert.equal(page.calls.length, 1);
    assert.equal(page.hasMore, false);
  });
  it('a cursor is passed through to the keyset comparison', async () => {
    const { c, seen } = controller([]);
    const cur = encodeCursor({ t: '2026-10-01T10:00:00.000001Z', i: ID_A });
    await c.feed(`Bearer ${goodToken()}`, cur, '5');
    assert.deepEqual(seen[0].params, ['2026-10-01T10:00:00.000001Z', ID_A, 6]);
    assert.match(seen[0].sql, /\(c\."updatedAt", c\.id\) > \(\$1::timestamptz, \$2::uuid\)/);
  });
});
