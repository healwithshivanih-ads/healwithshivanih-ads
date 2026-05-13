// Phone normalisation. We store every phone as E.164-without-plus
// (e.g. "+91 98924-45555" → "919892445555"). That matches WhatsApp's `wa_id`
// format and gives us a stable join key across CSV/Wix/WA imports.

import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalise to E.164-without-plus. Returns null if the number can't be parsed.
 * @param {string} input — anything user-typed: "+91-9892445555", "9892445555", "919892445555"
 * @param {string} [defaultCountry] — ISO-2, used when input has no country code
 */
export function normalizePhone(input, defaultCountry = 'IN') {
  if (!input) return null;
  const cleaned = String(input).replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (!parsed || !parsed.isValid()) {
      // Fall back to digits-only for malformed but plausible numbers.
      // Keeps imports tolerant; the matcher will compare exact strings either way.
      const digits = cleaned.replace(/\D/g, '');
      return digits.length >= 8 ? digits : null;
    }
    return parsed.number.replace(/^\+/, '');
  } catch {
    return null;
  }
}

/** True if `a` and `b` normalise to the same E.164-without-plus. */
export function phonesMatch(a, b, defaultCountry = 'IN') {
  const na = normalizePhone(a, defaultCountry);
  const nb = normalizePhone(b, defaultCountry);
  return !!na && na === nb;
}

/** Display-friendly format with the leading +. */
export function formatPhone(stored) {
  if (!stored) return '';
  return stored.startsWith('+') ? stored : `+${stored}`;
}
