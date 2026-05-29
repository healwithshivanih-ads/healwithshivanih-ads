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

// Wix location id "IN" — Shivani's distance-session marker.
const DISTANCE_LOCATION_IDS = new Set([
  '05fd2dd8-a460-4f7f-9c79-fa5adc16ddb3',
]);

/**
 * Returns 'distance' | 'in_person' for a decoded Wix booking envelope.
 * Defaults to 'in_person' if the location can't be read.
 *
 * Input: the inner envelope shape from decodeWixWebhook(), i.e. the
 * payload at createdEvent.entity (or updatedEvent.currentEntity) — same
 * shape extractBooking() in wix-bookings.js already navigates.
 */
export function classifyWixBooking(booking) {
  const locationId = pickLocationId(booking);
  if (locationId && DISTANCE_LOCATION_IDS.has(locationId)) return 'distance';
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
