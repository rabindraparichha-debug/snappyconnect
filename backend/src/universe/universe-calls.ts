/**
 * Pure helpers for GET /universe/calls — the call-history feed the SnappyHires
 * ATS pulls for its recruiter-wise calls report. See universe-calls.controller.ts.
 *
 * The feed is keyset-paged on (updatedAt, id) so a call whose disposition is
 * set later is delivered again with its new value. The cursor carries the
 * timestamp as Postgres rendered it, to the MICROSECOND: a JS Date would
 * truncate to milliseconds, and `(updatedAt, id) > (truncated, id)` is then
 * true for the very row the cursor came from — the caller would receive the
 * last row of every page forever.
 */

import { createHash, createHmac } from 'node:crypto';

export const FEED_DEFAULT_LIMIT = 200;
export const FEED_MAX_LIMIT = 500;

export type FeedCursor = { t: string; i: string };

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

/** A malformed cursor is null, never an exception: the caller gets a 422. */
export function decodeCursor(raw: unknown): FeedCursor | null {
  if (typeof raw !== 'string' || !raw || raw.length > 200) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!v || typeof v !== 'object') return null;
    const { t, i } = v as Record<string, unknown>;
    if (typeof t !== 'string' || !TS_RE.test(t)) return null;
    if (typeof i !== 'string' || !UUID_RE.test(i)) return null;
    return { t, i };
  } catch {
    return null;
  }
}

export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isInteger(n) || n < 1) return FEED_DEFAULT_LIMIT;
  return Math.min(n, FEED_MAX_LIMIT);
}

/**
 * The keyed tag that stands in for the dialled number.
 *
 * The ATS needs to tell "a call to a candidate this recruiter unlocked from
 * our pool" from "a call to some other number" — and the number itself must
 * still never leave SnappyConnect. So the feed carries a keyed hash instead,
 * and the ATS computes the same hash for the numbers it already holds. The
 * key is derived from UNIVERSE_JWT_SECRET, which both sides already share;
 * without it a tag cannot be reversed or tested against a guessed number.
 *
 * THE ALGORITHM IS A CONTRACT with lib/recruiter-watch/number-tag.ts in the
 * ATS repo — change one, change both:
 *   digits = the number's digits only, last 9 kept (fewer than 7 → no tag)
 *   key    = SHA-256("snappyhires:call-number-tag:v1:" + secret)
 *   tag    = first 32 hex characters of HMAC-SHA256(key, digits)
 *
 * Nine digits, not ten: "+971 50 123 4567" and "050 123 4567" only agree on
 * the last nine.
 */
export const TAG_CHECK_INPUT = '000000000';

export function tagDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

export function numberTagKey(secret: string): Buffer {
  return createHash('sha256').update(`snappyhires:call-number-tag:v1:${secret}`).digest();
}

export function numberTag(phone: string | null | undefined, key: Buffer): string | null {
  const digits = tagDigits(phone);
  if (!digits) return null;
  return createHmac('sha256', key).update(digits).digest('hex').slice(0, 32);
}

/**
 * What one call looks like on the feed. Deliberately NO phone number, contact
 * name, notes, transcript, AI summary or recording. numberTag is the keyed
 * hash above — never the number.
 */
export type FeedCall = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  direction: string;
  status: string;
  disposition: string | null;
  durationSeconds: number;
  ringTimeSeconds: number;
  region: string | null;
  source: string | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  numberTag: string | null;
};

/** The raw row the controller's SQL returns (cursorTs is the µs timestamp). */
export type FeedRow = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  direction: string;
  status: string;
  disposition: string | null;
  durationSeconds: number | string | null;
  ringTimeSeconds: number | string | null;
  region: string | null;
  source: string | null;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  cursorTs: string;
  /** Read only to compute numberTag; never copied onto the feed. */
  phoneNumber?: string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const int = (v: number | string | null): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

export function toFeedCall(r: FeedRow, tagKey?: Buffer): FeedCall {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    userEmail: r.userEmail ? r.userEmail.toLowerCase() : null,
    direction: r.direction,
    status: r.status,
    disposition: r.disposition,
    durationSeconds: int(r.durationSeconds),
    ringTimeSeconds: int(r.ringTimeSeconds),
    region: r.region,
    source: r.source,
    startedAt: iso(r.startedAt),
    endedAt: iso(r.endedAt),
    updatedAt: r.cursorTs,
    numberTag: tagKey ? numberTag(r.phoneNumber, tagKey) : null,
  };
}

/**
 * Page assembly: the SQL fetches limit+1 rows so hasMore is exact.
 * tagCheck is the tag of a fixed, non-secret input: the ATS compares it with
 * its own before trusting any numberTag, so two different secrets show up as
 * "tags ignored" instead of as every call looking unknown.
 */
export function buildPage(
  rows: FeedRow[],
  limit: number,
  tagKey?: Buffer,
): { calls: FeedCall[]; nextCursor: string | null; hasMore: boolean; tagCheck: string | null } {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    calls: page.map((r) => toFeedCall(r, tagKey)),
    nextCursor: last ? encodeCursor({ t: last.cursorTs, i: last.id }) : null,
    hasMore,
    tagCheck: tagKey ? numberTag(TAG_CHECK_INPUT, tagKey) : null,
  };
}
