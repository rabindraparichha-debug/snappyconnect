/**
 * Telnyx only accepts E.164 ("+18475960149"), but numbers reach the dialer as
 * bare 10-digit US numbers with spaces/dashes (call history, manual entry).
 * Mirrors toUsE164 in the backend's phone.util, but never throws: a number we
 * can't classify is returned cleaned of formatting and dialled as typed.
 */
export function toUsE164(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

/**
 * Whether a typed number is a US destination. NANP area codes start 2-9, so a
 * bare 10-digit number starting 2-9 is US — and can't be confused with UAE
 * local format (0XXXXXXXXX) or an Indian mobile number dialled with 91.
 */
export function isUsNumber(raw: string): boolean {
  const n = raw.replace(/[\s\-().]/g, '');
  return n.startsWith('+1') || /^1\d{10}$/.test(n) || /^[2-9]\d{9}$/.test(n);
}
