import { Region, REGION_DIAL_CODES } from './enums';

/**
 * Best-effort region for a dialed number, based on its international dial code.
 * Returns null for local-format numbers (e.g. UAE `05…`), where the caller's
 * granted regions decide instead.
 */
export function guessRegion(phoneNumber: string): Region | null {
  const n = phoneNumber.replace(/[\s\-().]/g, '');
  let best: { region: Region; length: number } | null = null;
  for (const [region, codes] of Object.entries(REGION_DIAL_CODES)) {
    for (const code of codes) {
      // Longest matching prefix wins so +971 beats +9 style overlaps.
      if (n.startsWith(code) && (!best || code.length > best.length)) {
        best = { region: region as Region, length: code.length };
      }
    }
  }
  return best?.region ?? null;
}

/**
 * Format a destination for the UAE trunk.
 *
 * The Asterisk `recruiters` context rewrites the +971/00971/971 forms to local
 * `0XXXXXXXXX` and routes anything starting with `0` out through the UCM. The
 * Dinstar strips only its own `8N` SIM-port prefix, so whatever remains is
 * dialled on the SIM verbatim — which means international destinations must
 * carry UAE's `00` access code, not a leading `+`.
 */
export function toUaeTrunkFormat(phoneNumber: string): string {
  const n = phoneNumber.replace(/[\s\-().]/g, '');
  if (!n) return n;

  // UAE destinations in any form: the dialplan already normalises these.
  if (n.startsWith('+971') || n.startsWith('00971') || /^971\d{8,}$/.test(n)) return n;

  // Local UAE (0XXXXXXXXX) and internal extensions pass through untouched.
  if (!n.startsWith('+') && !n.startsWith('00')) return n;

  // International: +44… -> 0044…; 00… is already correct.
  return n.startsWith('+') ? `00${n.slice(1)}` : n;
}
