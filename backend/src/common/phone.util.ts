import { BadRequestException } from '@nestjs/common';

/**
 * Telnyx only accepts E.164 ("+18475960149"), but numbers reach us as bare
 * 10-digit US numbers with spaces/dashes (call history, manual entry, admin
 * settings). SMS runs on the USA line, so +1 is the default country code for
 * bare numbers.
 */
export function toUsE164(raw: string, label = 'phone number'): string {
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (hasPlus) {
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  } else {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  throw new BadRequestException(
    `"${raw}" is not a valid ${label}. Use a 10-digit US number or the full international format (+1...).`,
  );
}
