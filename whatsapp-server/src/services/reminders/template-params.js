// Per-kind WhatsApp template parameter builders.
//
// Each entry maps a reminder kind to a function (appointment, contact) →
// { bodyParams: string[], buttonUrlSuffix?: string }.
//
// The params shape must match what the corresponding approved template
// expects (see scripts/submit-templates.js for the template bodies and
// their `example` arrays — `bodyParams` here must be the same length and
// order). When a template has a URL button (Zoom variants), buttonUrlSuffix
// holds the dynamic suffix that gets appended to the template's hardcoded
// `https://zoom.us/j/{{1}}` prefix.

const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Strip the prefix from a full Zoom join URL → returns just the meeting id
 * + query string (the "suffix" Meta plugs into the {{1}} of the URL button).
 *
 *   https://us02web.zoom.us/j/85123456789?pwd=abc123  →  85123456789?pwd=abc123
 *   https://zoom.us/j/85123456789                     →  85123456789
 *
 * Returns null if the input isn't a recognisable Zoom URL.
 */
export function zoomUrlSuffix(joinUrl) {
  if (!joinUrl || typeof joinUrl !== 'string') return null;
  const m = joinUrl.match(/zoom\.us\/(?:j|w|my)\/([^\s]+)$/i);
  return m ? m[1] : null;
}

/** Lowercase first-name from a contact's display_name. */
function firstNameOf(contact) {
  const n = (contact?.display_name || '').split(/\s+/)[0];
  return n || 'there';
}

function dateLabel(d, tz = DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
    }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}

function timeLabel(d, tz = DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
  } catch { return d.toISOString().slice(11, 16); }
}

/** Address for in-person templates: stash on metadata at booking-create time. */
function addressOf(appt) {
  return appt?.metadata?.wix_location_address
    || appt?.location
    || '(address details to follow)';
}

function serviceOf(appt) {
  return appt?.title || 'session';
}

function clientPhoneOf(contact) {
  return contact?.primary_phone || '';
}

// ---------------------------------------------------------------------------
// Builders keyed by reminder kind. Param order MUST match the template's
// `example` array in scripts/submit-templates.js.
// ---------------------------------------------------------------------------

const BUILDERS = {
  // ── Legacy 3 (existing pre-v0.64 templates) ────────────────────────────────
  confirmation(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [firstNameOf(contact), dateLabel(d), timeLabel(d), serviceOf(appt)],
    };
  },
  t_minus_24h(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [firstNameOf(contact), dateLabel(d), timeLabel(d), serviceOf(appt)],
    };
  },
  t_minus_2h(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [firstNameOf(contact), dateLabel(d), timeLabel(d), serviceOf(appt)],
    };
  },

  // ── Wix in-person (5-param + 5-param + 5-param + 4-param) ─────────────────
  // appt_confirm_inperson_client body params:
  //   {{1}} firstName · {{2}} date · {{3}} time · {{4}} serviceName · {{5}} address
  confirmation_inperson(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [
        firstNameOf(contact),
        dateLabel(d), timeLabel(d),
        serviceOf(appt),
        addressOf(appt),
      ],
    };
  },
  t_minus_24h_inperson_client(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [
        firstNameOf(contact),
        dateLabel(d), timeLabel(d),
        serviceOf(appt),
        addressOf(appt),
      ],
    };
  },
  // Coach-side 24h reminder.
  // body params: {{1}} clientName · {{2}} time · {{3}} serviceName · {{4}} address · {{5}} clientPhone
  t_minus_24h_inperson_coach(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [
        contact?.display_name || firstNameOf(contact),
        timeLabel(d),
        serviceOf(appt),
        addressOf(appt),
        clientPhoneOf(contact),
      ],
    };
  },
  // body params: {{1}} firstName · {{2}} time · {{3}} serviceName · {{4}} address
  t_minus_1h_inperson_client(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [
        firstNameOf(contact),
        timeLabel(d),
        serviceOf(appt),
        addressOf(appt),
      ],
    };
  },

  // ── Wix distance (2-param) ────────────────────────────────────────────────
  // body params: {{1}} firstName · {{2}} serviceName
  t_minus_5min_distance_client(appt, contact) {
    return {
      bodyParams: [firstNameOf(contact), serviceOf(appt)],
    };
  },

  // ── Cal.com Zoom (4 + 3 + 3 + 2-param + URL-button suffix on first three) ─
  confirmation_zoom(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [firstNameOf(contact), dateLabel(d), timeLabel(d), serviceOf(appt)],
      buttonUrlSuffix: zoomUrlSuffix(appt.join_url),
    };
  },
  t_minus_1h_zoom_client(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [firstNameOf(contact), timeLabel(d), serviceOf(appt)],
      buttonUrlSuffix: zoomUrlSuffix(appt.join_url),
    };
  },
  t_minus_1h_zoom_coach(appt, contact) {
    const d = new Date(appt.starts_at);
    return {
      bodyParams: [
        contact?.display_name || firstNameOf(contact),
        timeLabel(d),
        serviceOf(appt),
      ],
      buttonUrlSuffix: zoomUrlSuffix(appt.join_url),
    };
  },

  // ── No-show probe (2-param, quick-reply buttons — no URL) ─────────────────
  // body params: {{1}} firstName · {{2}} serviceName
  // Quick-reply buttons fire as inbound interactive.button_reply events;
  // there's no per-send button payload to build here.
  t_plus_5min_noshow_zoom_client(appt, contact) {
    return {
      bodyParams: [firstNameOf(contact), serviceOf(appt)],
    };
  },
};

/**
 * Build WhatsApp template components for a reminder kind.
 *
 * Returns { components, resolved } in the shape messages.send() / wa.sendTemplate()
 * already consume. `resolved` is the flat human-readable bag we stash on the
 * messages row for debugging.
 */
export function buildTemplateComponents(kind, appt, contact) {
  const builder = BUILDERS[kind];
  if (!builder) {
    // Defensive fallback: legacy 4-param shape.
    const d = new Date(appt.starts_at);
    return {
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstNameOf(contact) },
          { type: 'text', text: dateLabel(d) },
          { type: 'text', text: timeLabel(d) },
          { type: 'text', text: serviceOf(appt) },
        ],
      }],
      resolved: { fallback: true, kind },
    };
  }

  const { bodyParams, buttonUrlSuffix } = builder(appt, contact);
  const components = [{
    type: 'body',
    parameters: bodyParams.map((v) => ({ type: 'text', text: String(v ?? '') })),
  }];
  if (buttonUrlSuffix) {
    // Meta URL-button param: index 0, sub_type 'url', single text param
    // that replaces {{1}} in the template's URL (e.g. zoom.us/j/{{1}}).
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: String(buttonUrlSuffix) }],
    });
  }
  return {
    components,
    resolved: { kind, bodyParams, buttonUrlSuffix: buttonUrlSuffix || null },
  };
}
