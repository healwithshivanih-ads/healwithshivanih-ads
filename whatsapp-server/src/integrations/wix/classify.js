// Wix booking classifier.
//
// Wix Bookings v2 has NO native "online/virtual/distance" flag — the
// Service.LocationType enum is just BUSINESS|CUSTOM|CUSTOMER, and the
// Booking.LocationType enum is UNDEFINED|OWNER_BUSINESS|OWNER_CUSTOM|
// CUSTOM. All physical-address-based.
//
// Shivani's convention: one of her registered Wix locations is named
// "IN" with formattedAddress just "India" (no street/city), and she
// uses that location for distance/remote sessions. The other 4
// locations (Senapati Bapat Marg + G D Ambekar Road in Mumbai, New
// Delhi, Dubai) are physical clinics.
//
// So classification is: location.id === <distance-id> → 'distance',
// anything else → 'in_person'.
//
// If you onboard more distance locations later, add their ids to
// DISTANCE_LOCATION_IDS.

// Wix location id "IN" — Shivani's distance-session marker (a registered
// business location with formattedAddress just "India").
const DISTANCE_LOCATION_IDS = new Set([
  '05fd2dd8-a460-4f7f-9c79-fa5adc16ddb3',
]);

// Wix service-id direct map — most reliable signal when present. Populate
// from `services_v2/query` (see scripts/audit-wix-services.mjs).
const DISTANCE_SERVICE_IDS = new Set([
  // (none mapped yet — extend when service ids are known)
]);

// Fallback heuristic: when a service uses an OWNER_CUSTOM location with no
// `id` (a per-service free-form address, not a registered business
// location), Wix gives us nothing structural to classify on. We fall back
// to matching distance keywords in the service title or the formatted
// address — covers the "Distance Healing" service whose address is
// "Done distantly based on on pre-decided time".
const DISTANCE_NAME_RE = /\b(distance|distant|remote|online|virtual|tele)\w*\b/i;

/**
 * Returns 'distance' | 'in_person' for a decoded Wix booking envelope.
 * Defaults to 'in_person' if no distance signal is found.
 *
 * Input: the inner envelope shape from decodeWixWebhook(), i.e. the
 * payload at createdEvent.entity (or updatedEvent.currentEntityAsJson) —
 * same shape extractBooking() in wix-bookings.js already navigates.
 *
 * Detection priority (first match wins):
 *   1. location.id is in DISTANCE_LOCATION_IDS
 *      (the registered "IN" business location)
 *   2. serviceId is in DISTANCE_SERVICE_IDS
 *      (direct override for known services — most reliable)
 *   3. service title or location formattedAddress matches DISTANCE_NAME_RE
 *      (catches Distance Healing + similar free-form custom-location
 *       services)
 */
export function classifyWixBooking(booking) {
  if (!booking) return 'in_person';

  const locationId = pickLocationId(booking);
  if (locationId && DISTANCE_LOCATION_IDS.has(locationId)) return 'distance';

  const serviceId = pickServiceId(booking);
  if (serviceId && DISTANCE_SERVICE_IDS.has(serviceId)) return 'distance';

  // Name-based fallback. Checks both the service title and the location's
  // formatted address so e.g. "Distance Healing" (title) and "Done
  // distantly…" (address) both resolve.
  const title = pickServiceTitle(booking) || '';
  const address = pickLocationAddress(booking) || '';
  if (DISTANCE_NAME_RE.test(title) || DISTANCE_NAME_RE.test(address)) return 'distance';

  return 'in_person';
}

/**
 * Pull location.id out of any of the known Wix booking payload shapes.
 * Mirrors the defensive walk in extractBooking() so the two stay aligned.
 */
export function pickLocationId(booking) {
  if (!booking) return null;
  // Most common in v2 webhooks (per Booking Created docs):
  //   booking.bookedEntity.slot.location.id
  // Plus a few fallbacks for variants Wix has been seen to send:
  return (
    booking.bookedEntity?.slot?.location?.id
    || booking.bookedEntity?.location?.id
    || booking.slot?.location?.id
    || booking.location?.id
    || null
  );
}

/** Pull the service id out of any of the known Wix booking payload shapes. */
export function pickServiceId(booking) {
  if (!booking) return null;
  return (
    booking.bookedEntity?.slot?.serviceId
    || booking.bookedEntity?.serviceId
    || booking.slot?.serviceId
    || booking.serviceId
    || null
  );
}

/** Pull the service title (e.g. "Distance Healing"). */
export function pickServiceTitle(booking) {
  if (!booking) return null;
  return (
    booking.bookedEntity?.title
    || booking.bookedEntity?.serviceName
    || booking.serviceName
    || booking.title
    || null
  );
}

/**
 * Pull the human-readable address out of the booking. Used for the
 * {{address}} template param on in-person reminders.
 *
 * Prefers formattedAddress (e.g. "ICC TWO, Island City Center, G D
 * Ambekar Road, Dadar East, Mumbai") — fallback to the location name
 * (e.g. "G D Ambekar Road").
 */
export function pickLocationAddress(booking) {
  if (!booking) return null;
  const loc = booking.bookedEntity?.slot?.location
    || booking.bookedEntity?.location
    || booking.slot?.location
    || booking.location;
  if (!loc) return null;
  return loc.formattedAddress || loc.name || null;
}

export { DISTANCE_LOCATION_IDS };
