import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Pending app-return codes for "Continue with SnappyHires" in the mobile app.
 *
 * Kept in memory on purpose: the API runs as ONE node process (systemd unit
 * snappyconnect-api, `node dist/main.js`, no cluster), a code lives two
 * minutes and is used once, and losing them on a restart only means the
 * person taps the button again. If the API is ever run as several processes
 * or behind a load balancer, move this to the database (or Redis) first —
 * otherwise the exchange can land on a process that never issued the code.
 *
 * A code carries no token. It is bound to the app's challenge
 * (base64url SHA-256 of a secret the app keeps), so a code captured by
 * another app claiming the same URL scheme is useless without that secret.
 */
export const APP_CODE_TTL_MS = 2 * 60_000;
const MAX_PENDING = 5_000;

/** base64url, no padding, of a 32-byte SHA-256 digest. */
export const APP_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

interface Pending {
  email: string;
  challenge: string;
  expiresAt: number;
}

export class AppCodeStore {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.pending.size;
  }

  /** A new single-use code for this verified e-mail, bound to the challenge. */
  issue(email: string, challenge: string): string {
    this.sweep();
    if (this.pending.size >= MAX_PENDING) {
      // Bound memory: drop the oldest (Map keeps insertion order).
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    const code = randomBytes(32).toString('base64url');
    this.pending.set(code, { email, challenge, expiresAt: this.now() + APP_CODE_TTL_MS });
    return code;
  }

  /**
   * The e-mail the code was issued for, or null. The code is removed before
   * anything is checked, so a wrong verifier burns it as well.
   */
  take(code: string, verifier: string): string | null {
    const entry = this.pending.get(code);
    this.pending.delete(code);
    if (!entry || entry.expiresAt <= this.now()) return null;
    const expected = Buffer.from(entry.challenge);
    const actual = Buffer.from(challengeFor(verifier));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return entry.email;
  }

  private sweep() {
    const now = this.now();
    for (const [code, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(code);
    }
  }
}
