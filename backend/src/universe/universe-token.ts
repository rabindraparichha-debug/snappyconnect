import { createHmac, timingSafeEqual } from 'crypto';

/**
 * The SnappyHires "universe service token": an HS256 JWT signed with the
 * shared GoTrue secret, with aud "authenticated", role "service" and the
 * calling product in app_metadata.app. It is NOT a SnappyConnect session —
 * it never passes JwtAuthGuard and carries no user — so it is verified here,
 * by hand, against its own secret (UNIVERSE_JWT_SECRET).
 */
export const UNIVERSE_ALLOWED_APPS = ['ats', 'support'] as const;

export type UniverseTokenResult =
  | { ok: true; app: string }
  | { ok: false; reason: string };

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function verifyUniverseServiceToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
  allowedApps: readonly string[] = UNIVERSE_ALLOWED_APPS,
): UniverseTokenResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts;

  // The algorithm is pinned: "none" or an asymmetric alg is never accepted.
  const header = decodePart(h);
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'algorithm' };

  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' };
  }

  const claims = decodePart(p);
  if (!claims) return { ok: false, reason: 'malformed' };

  if ('exp' in claims && claims.exp !== undefined && claims.exp !== null) {
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
      return { ok: false, reason: 'expired' };
    }
    if (claims.exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > nowMs + 60_000) {
    return { ok: false, reason: 'not yet valid' };
  }

  const aud = claims.aud;
  const audOk = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
  if (!audOk) return { ok: false, reason: 'audience' };
  if (claims.role !== 'service') return { ok: false, reason: 'role' };

  const meta = claims.app_metadata;
  const app =
    meta && typeof meta === 'object' ? (meta as Record<string, unknown>).app : undefined;
  if (typeof app !== 'string' || !allowedApps.includes(app)) {
    return { ok: false, reason: 'app' };
  }
  return { ok: true, app };
}
