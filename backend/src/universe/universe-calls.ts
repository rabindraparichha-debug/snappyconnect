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
 * What one call looks like on the feed. Deliberately NO phone number, contact
 * name, notes, transcript, AI summary or recording: the ATS report counts
 * calls per recruiter and needs none of it.
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
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const int = (v: number | string | null): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

export function toFeedCall(r: FeedRow): FeedCall {
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
  };
}

/** Page assembly: the SQL fetches limit+1 rows so hasMore is exact. */
export function buildPage(
  rows: FeedRow[],
  limit: number,
): { calls: FeedCall[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    calls: page.map(toFeedCall),
    nextCursor: last ? encodeCursor({ t: last.cursorTs, i: last.id }) : null,
    hasMore,
  };
}
