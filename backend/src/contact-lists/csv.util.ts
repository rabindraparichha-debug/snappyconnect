/**
 * Minimal RFC-4180 CSV reader: handles quoted fields, escaped quotes ("")
 * inside them, and both CRLF and LF line endings. Recruiters paste exports
 * from spreadsheets, so quoted commas are the case that actually matters.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  // Trailing field/row when the file does not end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Digits and a single leading +, so numbers compare consistently. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return plus ? `+${digits}` : digits;
}

/**
 * E.164 form ("+16305551234") for storing and comparing phone numbers.
 *
 * normalizePhone only strips punctuation, so "630-555-1234" and the
 * "+16305551234" Telnyx reports on a reply never matched — a reply or a STOP
 * could miss the conversation it belonged to. Keeps an explicit +; takes 10
 * digits, or 11 starting with 1, as US/Canada. Under 10 digits isn't a
 * dialable number, so it is only cleaned, not guessed at.
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length < 10) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
