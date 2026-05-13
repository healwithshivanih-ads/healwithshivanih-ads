// Wix → us field mapping. Pure functions; no DB access here.
// See docs/wix-mapping.md §2 for the source-of-truth tables.

const SUBSCRIPTION_MAP = {
  subscribed: 'subscribed',
  unsubscribed: 'unsubscribed',
  notSet: 'never_subscribed',
  pending: 'unknown',
  // Newer Wix shapes use uppercase
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  NOT_SET: 'never_subscribed',
  PENDING: 'unknown',
};

const LOCALE_MAP = {
  English: 'en-IN',
  Hindi: 'hi-IN',
  Marathi: 'mr-IN',
  Gujarati: 'gu-IN',
};

const SOURCE_MAP = {
  'Form Submission': 'website_form',
  FORM_SUBMISSION: 'website_form',
  Member: 'wix_member',
  MEMBER: 'wix_member',
  Booking: 'wix_booking',
  BOOKING: 'wix_booking',
  Manual: 'wix_manual',
};

export function wixSubscriptionStatus(wixStatus) {
  if (!wixStatus) return 'unknown';
  return SUBSCRIPTION_MAP[wixStatus] || 'unknown';
}

export function wixLocale(wixSpoken) {
  if (!wixSpoken) return null;
  return LOCALE_MAP[wixSpoken] || 'en-IN';
}

export function wixSourceToOptIn(wixSource) {
  if (!wixSource) return null;
  return SOURCE_MAP[wixSource] || `wix:${wixSource.toString().toLowerCase().replace(/\s+/g, '_')}`;
}

export function splitName(displayName) {
  if (!displayName) return { first: null, last: null };
  const parts = String(displayName).trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function joinName(first, last) {
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

/**
 * Convert a full Wix REST contact (v4) to our matcher candidate + upsert input.
 * Returns:
 *   {
 *     candidate: { wix_id, phone, email, display_name, locale, city, country,
 *                  opt_in_source, metadata },
 *     identities: [{channel, external_id, is_primary, subscription_status}, ...],
 *     labels: [string, ...],
 *     subscription: { whatsapp, email },     // for explicit identity sub-status
 *     wix_updated_at: ISO,
 *   }
 */
export function wixContactToCandidate(wixContact) {
  if (!wixContact) throw new Error('wixContactToCandidate: empty input');

  // Wix v4 puts everything under .info but webhook payloads sometimes have
  // a flatter shape — handle both defensively.
  const info = wixContact.info || wixContact;
  const wix_id = wixContact._id || wixContact.id || wixContact.contactId;

  const nameObj = info.name || {};
  const display_name = joinName(nameObj.first, nameObj.last) || info.displayName || null;

  const primaryEmail = (info.emails && info.emails.items && info.emails.items[0])
    || info.primaryEmail || (info.emails && info.emails.primary) || null;
  const email = primaryEmail?.email || primaryEmail?.address || null;

  const primaryPhone = (info.phones && info.phones.items && info.phones.items[0])
    || info.primaryPhone || (info.phones && info.phones.primary) || null;
  const phoneRaw = primaryPhone?.phone || primaryPhone?.e164Phone || primaryPhone?.formattedPhone || null;
  const phoneCountryCode = primaryPhone?.countryCode || null;

  const address = (info.addresses && info.addresses.items && info.addresses.items[0])
    || info.primaryAddress || (info.addresses && info.addresses.primary) || null;
  const city = address?.address?.city || address?.city || null;
  const country = address?.address?.country || address?.country || null;

  // Custom fields — Wix exposes these as a map keyed by name.
  const custom = info.extendedFields?.items || info.customFields || info.extendedFields || {};
  const cf = (k) => {
    if (!custom) return null;
    if (Array.isArray(custom)) {
      const hit = custom.find((x) => x?.name === k || x?.key === k);
      return hit?.value ?? null;
    }
    if (typeof custom === 'object') {
      const direct = custom[k];
      if (direct == null) return null;
      if (typeof direct === 'object') return direct.value ?? direct.text ?? null;
      return direct;
    }
    return null;
  };

  const requestedSpoken = cf('RequestedSpokenLanguage') || cf('contacts.custom.requestedspokenlanguage');
  const locale = wixLocale(requestedSpoken);

  const labelsRaw = info.labelKeys?.items || info.labelKeys || info.labels || [];
  const labels = Array.isArray(labelsRaw)
    ? labelsRaw.map((l) => (typeof l === 'string' ? l : l?.key || l?.name)).filter(Boolean)
    : [];

  const sourceRaw = wixContact.source?.sourceType || info.source?.sourceType || wixContact.sourceType || null;

  const metadata = {
    wix_id,
    requested_spoken_language: requestedSpoken || undefined,
    notes_wix: cf('Notes') || undefined,
    company_size: cf('CompanySize') || undefined,
    vat_id: cf('VatId') || undefined,
    extra_phone: cf('ExtraPhone') || undefined,
    other_phone: cf('OtherPhone') || undefined,
    country_code: cf('CountryCode') || undefined,
    registered_on: cf('RegisteredOn') || undefined,
    address: address ? {
      street: address?.address?.streetAddress?.name || address?.street || undefined,
      street2: address?.address?.streetAddress?.formattedAddressLine || address?.street2 || undefined,
      zip: address?.address?.postalCode || address?.zip || undefined,
    } : undefined,
  };
  // Strip undefined keys
  for (const k of Object.keys(metadata)) if (metadata[k] === undefined) delete metadata[k];

  // Identities (subscription status normalised).
  const identities = [];
  if (wix_id) {
    identities.push({
      channel: 'wix', external_id: wix_id, is_primary: true,
      subscription_status: 'unknown',
    });
  }
  if (phoneRaw) {
    identities.push({
      channel: 'whatsapp',
      external_id: phoneRaw,
      is_primary: true,
      subscription_status: wixSubscriptionStatus(primaryPhone?.subscriptionStatus),
    });
  }
  if (email) {
    identities.push({
      channel: 'email',
      external_id: email,
      is_primary: true,
      subscription_status: wixSubscriptionStatus(primaryEmail?.subscriptionStatus),
    });
  }
  // Extra phones
  for (const k of ['extra_phone', 'other_phone']) {
    if (metadata[k]) {
      identities.push({
        channel: 'whatsapp', external_id: metadata[k], is_primary: false,
        subscription_status: 'unknown',
      });
    }
  }

  return {
    candidate: {
      wix_id,
      phone: phoneRaw,
      email,
      display_name,
      locale,
      city,
      country,
      opt_in_source: wixSourceToOptIn(sourceRaw),
      metadata,
    },
    identities,
    labels,
    wix_updated_at: wixContact._updatedDate || info._updatedDate || wixContact.updatedAt || null,
    wix_created_at: wixContact._createdDate || info._createdDate || wixContact.createdAt || null,
    phone_country_code: phoneCountryCode,
  };
}
