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
