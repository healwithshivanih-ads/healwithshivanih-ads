"use server";

/**
 * Cal.com booking server actions.
 *
 * REQUIRES env var:
 *   CALCOM_API_KEY=cal_live_...   (add to .env.local — distinct from the
 *                                 inbound webhook key)
 *
 * The Cal.com v2 API is documented at https://cal.com/docs/api-reference/v2/introduction.
 *
 * This module exposes three actions to the UI:
 *   - listEventTypesAction()          → merge _calcom_links.yaml with live
 *                                       eventTypeIds discovered from Cal.com.
 *   - listAvailableSlotsAction(slug)  → flat array of available slots for
 *                                       the next N days, grouped by date in
 *                                       the caller's UI.
 *   - createBookingAction(input)      → POST /v2/bookings on the client's
 *                                       behalf. Cal.com handles calendar
 *                                       block, Zoom link, client reminders.
 *
 * It also re-exports the YAML-link loader + a slim `sendBookingLinkAction`
 * so the modal can drive both flows (direct-book and send-link) from one
 * place — this worktree predates the dedicated send-booking panel/action,
 * so the action is a thin in-place implementation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { revalidatePath } from "next/cache";
import { getPlansRoot } from "@/lib/fmdb/paths";
import type {
  CalcomLink,
  EventTypeOption,
  SlotOption,
  CreateBookingInput,
  CreateBookingResult,
  SendBookingLinkInput,
} from "./types";

// ── Cal.com fetcher ───────────────────────────────────────────────────────────

const CALCOM_API_BASE = "https://api.cal.com/v2";

function calcomHeaders(apiVersion: string = "2024-06-14"): Record<string, string> {
  const key = process.env.CALCOM_API_KEY;
  if (!key) {
    throw new Error(
      "CALCOM_API_KEY is not set in .env.local — add `CALCOM_API_KEY=cal_live_...` and restart."
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    // Per-endpoint version overrides (verified live 2026-05-19):
    //   /v2/me                  → 2024-06-14 ✓
    //   /v2/event-types         → 2024-06-14 ✓ (2024-08-13 = 404)
    //   /v2/slots/available     → 2024-06-14 ✓
    //   /v2/bookings POST       → 2024-08-13 ✓ (2024-06-14 = 400)
    //   /v2/bookings/<uid>/cancel → 2024-08-13 ✓
    // The booking schema changed between 2024-06-14 and 2024-08-13
    // (timeZone moved from top-level to inside attendee). Don't try to
    // unify — keep per-endpoint and document each one's working version.
    "cal-api-version": apiVersion,
  };
}

async function calcomFetch(
  pathname: string,
  init: RequestInit = {},
  apiVersion?: string,
): Promise<Response> {
  const url = `${CALCOM_API_BASE}${pathname}`;
  return fetch(url, { ...init, headers: { ...calcomHeaders(apiVersion), ...(init.headers ?? {}) } });
}

// ── YAML link loader ──────────────────────────────────────────────────────────

async function loadCalcomLinksYaml(): Promise<CalcomLink[]> {
  const file = path.join(getPlansRoot(), "_calcom_links.yaml");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = yaml.load(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CalcomLink[];
  } catch {
    return [];
  }
}

export async function loadCalcomLinksAction(): Promise<CalcomLink[]> {
  return loadCalcomLinksYaml();
}

// ── Event-type discovery (slug → eventTypeId) ─────────────────────────────────
// Cached for the lifetime of the Node process. Cal.com event-type IDs don't
// change unless coach reconfigures them.

let _eventTypeCache: { ts: number; map: Map<string, number> } | null = null;
const EVENT_TYPE_CACHE_MS = 10 * 60 * 1000; // 10 min

// Resolved Cal.com username for the authenticated coach. /v2/event-types
// REQUIRES `?username=<slug>` — discovered via /v2/me on first call.
// Cached for the process lifetime since coach's username doesn't change.
let _calcomUsernameCache: { ts: number; username: string } | null = null;
async function getCalcomUsername(): Promise<string> {
  const now = Date.now();
  if (_calcomUsernameCache && now - _calcomUsernameCache.ts < EVENT_TYPE_CACHE_MS) {
    return _calcomUsernameCache.username;
  }
  // /v2/me returns 200 with {data: {username, ...}} for any valid key.
  // Use a known-working api version for /v2/me (2024-06-14 + 2024-08-13
  // both work; pick the latter for consistency with the rest of the action).
  const res = await calcomFetch("/me");
  if (!res.ok) {
    throw new Error(
      `Cal.com /me failed: ${res.status} ${res.statusText}. Check CALCOM_API_KEY validity.`,
    );
  }
  const body = (await res.json()) as { data?: { username?: string } };
  const username = body?.data?.username ?? "";
  if (!username) {
    throw new Error("Cal.com /me returned no username — account may be misconfigured.");
  }
  _calcomUsernameCache = { ts: now, username };
  return username;
}

/**
 * Extract the Cal.com slug (last URL segment) from a YAML entry's URL.
 * `https://cal.com/shivani-hariharan-0xyy3l/discovery-consultation`
 *   → `discovery-consultation`
 */
function calcomSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  } catch {
    return "";
  }
}

async function discoverEventTypeIds(): Promise<Map<string, number>> {
  const now = Date.now();
  if (_eventTypeCache && (now - _eventTypeCache.ts) < EVENT_TYPE_CACHE_MS) {
    return _eventTypeCache.map;
  }
  const map = new Map<string, number>();
  try {
    // Cal.com v2 REQUIRES the `?username=` query on /v2/event-types.
    // Without it the endpoint returns 404 "Cannot GET /v2/event-types".
    // Confirmed against Shivani's account 2026-05-19. Username is
    // resolved from /v2/me and cached for the process lifetime.
    const username = await getCalcomUsername();
    const res = await calcomFetch(
      `/event-types?username=${encodeURIComponent(username)}`,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[calcom] event-types fetch failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
      );
      _eventTypeCache = { ts: now, map };
      return map;
    }
    const body = await res.json() as { data?: unknown };
    // For personal accounts (no org), v2 returns `{data: [...event types]}`.
    // For org/team accounts, it returns `{data: {eventTypeGroups: [...]}}`.
    // Handle both shapes defensively.
    const flat: Array<Record<string, unknown>> = [];
    const data = body.data as unknown;
    if (Array.isArray(data)) {
      flat.push(...(data as Array<Record<string, unknown>>));
    } else if (data && typeof data === "object") {
      const groups = (data as Record<string, unknown>).eventTypeGroups;
      if (Array.isArray(groups)) {
        for (const g of groups as Array<Record<string, unknown>>) {
          const ets = g.eventTypes;
          if (Array.isArray(ets)) flat.push(...(ets as Array<Record<string, unknown>>));
        }
      }
    }
    for (const et of flat) {
      const slug = typeof et.slug === "string" ? et.slug : "";
      const id = typeof et.id === "number" ? et.id : Number(et.id);
      if (slug && Number.isFinite(id)) map.set(slug, id);
    }
  } catch (err) {
    console.warn("[calcom] event-types fetch errored:", err);
  }
  _eventTypeCache = { ts: now, map };
  return map;
}

export async function listEventTypesAction(): Promise<{
  ok: boolean;
  options: EventTypeOption[];
  error?: string;
}> {
  const links = await loadCalcomLinksYaml();
  if (!process.env.CALCOM_API_KEY) {
    // Link-send only is still possible without an API key — return YAML
    // entries with eventTypeId=null and let the modal disable direct-book.
    return {
      ok: false,
      options: links.map((l) => ({
        ...l,
        eventTypeId: null,
        eventTypeSlug: calcomSlugFromUrl(l.url),
      })),
      error: "CALCOM_API_KEY is not set — direct booking disabled. Add it to .env.local to enable.",
    };
  }
  try {
    const idMap = await discoverEventTypeIds();
    const options: EventTypeOption[] = links.map((l) => {
      const calcomSlug = calcomSlugFromUrl(l.url);
      return { ...l, eventTypeSlug: calcomSlug, eventTypeId: idMap.get(calcomSlug) ?? null };
    });
    return { ok: true, options };
  } catch (err) {
    return {
      ok: false,
      options: links.map((l) => ({
        ...l,
        eventTypeSlug: calcomSlugFromUrl(l.url),
        eventTypeId: null,
      })),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Slot listing ──────────────────────────────────────────────────────────────

const IST_TZ = "Asia/Kolkata";

function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: IST_TZ, hour: "numeric", minute: "2-digit", hour12: true,
  }) + " IST";
}

function formatIstDateKey(iso: string): string {
  // Returns YYYY-MM-DD in IST
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

function formatIstDateLabel(iso: string): string {
  // "Mon 19 May"
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: IST_TZ, weekday: "short", day: "numeric", month: "short",
  });
}

export async function listAvailableSlotsAction(
  eventTypeSlugYaml: string,
  daysAhead: number = 14,
): Promise<{ ok: boolean; slots: SlotOption[]; error?: string }> {
  if (!process.env.CALCOM_API_KEY) {
    return { ok: false, slots: [], error: "CALCOM_API_KEY not set — add to .env.local." };
  }
  const { options } = await listEventTypesAction();
  const opt = options.find((o) => o.slug === eventTypeSlugYaml);
  if (!opt) return { ok: false, slots: [], error: `Unknown event type: ${eventTypeSlugYaml}` };
  if (!opt.eventTypeId) {
    return {
      ok: false, slots: [],
      error: `Cal.com event type "${opt.eventTypeSlug}" not found in your account. Check it exists at cal.com.`,
    };
  }
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + Math.max(1, daysAhead));
  const q = new URLSearchParams({
    eventTypeId: String(opt.eventTypeId),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  });
  try {
    const res = await calcomFetch(`/slots/available?${q.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, slots: [], error: `Cal.com /slots/available ${res.status}: ${text.slice(0, 200)}` };
    }
    const body = await res.json() as { data?: unknown };
    // Cal.com returns either:
    //   { data: { slots: { "2026-05-19": [{time: "..."}, ...], ... } } }   (grouped)
    // or { data: [{time: "..."}, ...] }                                    (flat)
    // We normalise to a flat array of ISO strings.
    const isoStrings: string[] = [];
    const data = body.data as unknown;
    if (Array.isArray(data)) {
      for (const s of data as Array<Record<string, unknown>>) {
        const t = typeof s.time === "string" ? s.time : (typeof s.start === "string" ? s.start : "");
        if (t) isoStrings.push(t);
      }
    } else if (data && typeof data === "object") {
      const slots = (data as Record<string, unknown>).slots;
      if (slots && typeof slots === "object") {
        for (const v of Object.values(slots as Record<string, unknown>)) {
          if (Array.isArray(v)) {
            for (const s of v as Array<Record<string, unknown>>) {
              const t = typeof s.time === "string" ? s.time : (typeof s.start === "string" ? s.start : "");
              if (t) isoStrings.push(t);
            }
          }
        }
      }
    }
    const slots: SlotOption[] = isoStrings
      .filter((iso) => !Number.isNaN(new Date(iso).getTime()))
      .map((iso) => ({
        startIso: iso,
        label: formatIstTime(iso),
        dateKey: formatIstDateKey(iso),
        dateLabel: formatIstDateLabel(iso),
      }))
      .sort((a, b) => a.startIso.localeCompare(b.startIso));
    return { ok: true, slots };
  } catch (err) {
    return { ok: false, slots: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Booking creation ──────────────────────────────────────────────────────────

export async function createBookingAction(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  if (!process.env.CALCOM_API_KEY) {
    return { ok: false, error: "CALCOM_API_KEY not set — add to .env.local." };
  }
  const { options } = await listEventTypesAction();
  const opt = options.find((o) => o.slug === input.eventTypeSlug);
  if (!opt) return { ok: false, error: `Unknown event type: ${input.eventTypeSlug}` };
  if (!opt.eventTypeId) {
    return { ok: false, error: `Cal.com event type id missing for slug "${opt.eventTypeSlug}".` };
  }
  if (!input.clientEmail) {
    return { ok: false, error: "Client email is required by Cal.com to send the confirmation + Zoom link." };
  }
  const body = {
    start: new Date(input.slotIso).toISOString(),
    eventTypeId: opt.eventTypeId,
    attendee: {
      name: input.clientName,
      email: input.clientEmail,
      timeZone: IST_TZ,
      language: "en",
      ...(input.clientPhone ? { phoneNumber: input.clientPhone } : {}),
    },
    metadata: {
      clientId: input.clientId,
      bookedBy: "coach",
      ...(input.notes ? { coachNotes: input.notes } : {}),
    },
    ...(input.notes ? { bookingFieldsResponses: { notes: input.notes } } : {}),
  };
  try {
    // /v2/bookings POST requires api version 2024-08-13 specifically
    // (2024-06-14 returns 400 "timeZone must be a valid IANA time-zone"
    // because the booking schema changed between the two versions).
    // Verified live 2026-05-19.
    const res = await calcomFetch(
      "/bookings",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      "2024-08-13",
    );
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* swallow */ }
    if (!res.ok) {
      const errMsg = parsed
        ? (typeof parsed.message === "string"
            ? parsed.message
            : typeof (parsed.error as Record<string, unknown>)?.message === "string"
              ? String((parsed.error as Record<string, unknown>).message)
              : text.slice(0, 300))
        : text.slice(0, 300);
      return { ok: false, error: `Cal.com /bookings ${res.status}: ${errMsg}` };
    }
    const data = (parsed?.data ?? parsed) as Record<string, unknown> | undefined;
    const uid = typeof data?.uid === "string" ? data.uid : (typeof data?.id === "string" ? data.id : undefined);
    const eventUrl = typeof data?.location === "string" ? data.location : undefined;

    // ── Immediate write to _calcom_bookings.yaml ─────────────────────────
    // The cal.com inbound webhook normally populates this file when Cal.com
    // fires BOOKING_CREATED — but webhook delivery isn't guaranteed and we
    // don't want the coach to see a stale dashboard while the booking is
    // already live on cal.com. Write it directly here keyed by clientId;
    // when the webhook does fire it'll dedup by uid and update if needed.
    // Match the StoredBooking shape used by the webhook + loadUpcomingBookings.
    if (uid) {
      try {
        const root = getPlansRoot();
        const bookingsFile = path.join(root, "_calcom_bookings.yaml");
        let bookings: Record<string, Array<Record<string, unknown>>> = {};
        try {
          const raw = await fs.readFile(bookingsFile, "utf-8");
          const parsedFile = yaml.load(raw);
          if (parsedFile && typeof parsedFile === "object" && !Array.isArray(parsedFile)) {
            bookings = parsedFile as Record<string, Array<Record<string, unknown>>>;
          }
        } catch { /* missing or invalid → start fresh */ }
        const startIso = new Date(input.slotIso).toISOString();
        const endIso = new Date(new Date(input.slotIso).getTime() + 60 * 60 * 1000).toISOString();
        const evt: Record<string, unknown> = {
          received_at: new Date().toISOString(),
          type: "booking_created",
          uid,
          external_id: `cal_com:${uid}`,
          start_time: startIso,
          end_time: endIso,
          event_slug: input.eventTypeSlug,
          event_title: opt.label,
          attendee_email: input.clientEmail,
          attendee_phone: input.clientPhone ?? undefined,
          attendee_name: input.clientName,
          matched_by: null,
          source: "coach_initiated",
          location: eventUrl ? "video" : null,
          join_url: eventUrl ?? null,
        };
        const list = (bookings[input.clientId] ?? []).filter((r) => r.uid !== uid);
        list.unshift(evt);
        bookings[input.clientId] = list.slice(0, 50);
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(bookingsFile, yaml.dump(bookings, { sortKeys: true }), "utf-8");
      } catch {
        /* swallow — booking already succeeded on cal.com side, the webhook
         * will eventually populate this file. */
      }
    }

    // Revalidate the surfaces that render upcoming bookings so the coach
    // sees her booking immediately without a hard refresh.
    try {
      revalidatePath("/dashboard-v2");
      revalidatePath(`/clients-v2/${input.clientId}`);
      revalidatePath(`/clients-v2/${input.clientId}/analyse`);
      revalidatePath(`/clients-v2/${input.clientId}/sessions`);
    } catch { /* not in request context — skip */ }

    return { ok: true, bookingUid: uid, calcomEventUrl: eventUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Send-link flow (WhatsApp / fallback) ──────────────────────────────────────
// Slim implementation for this worktree. If the project already exports
// `sendBookingLinkAction` from `whatsapp/calcom-actions.ts`, prefer that and
// delete this. Kept here so the modal can fall back without a hard import.

export async function sendBookingLinkAction(
  input: SendBookingLinkInput,
): Promise<{ ok: boolean; method: "whatsapp" | "aisensy" | "manual"; url: string; error?: string }> {
  const links = await loadCalcomLinksYaml();
  const link = links.find((l) => l.slug === input.eventTypeSlug);
  if (!link) {
    return { ok: false, method: "manual", url: "", error: `Unknown event type: ${input.eventTypeSlug}` };
  }
  const url = link.template_param_url ?? link.url;

  // Try AiSensy direct API if configured. Falls back to manual copy/paste
  // when no transport is wired up.
  const aisensyKey = process.env.AISENSY_API_KEY;
  if (aisensyKey && input.clientPhone) {
    const phone = input.clientPhone.replace(/[^\d]/g, "");
    const e164 = phone.length === 10 ? `91${phone}` : phone;
    try {
      const res = await fetch("https://backend.aisensy.com/direct-apis/t1/create-message", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aisensyKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: e164,
          type: "template",
          template: {
            name: "fm_book_session_v1",
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: input.clientName },
                  { type: "text", text: url },
                ],
              },
            ],
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, method: "aisensy", url, error: `AiSensy ${res.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, method: "aisensy", url };
    } catch (err) {
      return { ok: false, method: "aisensy", url, error: err instanceof Error ? err.message : String(err) };
    }
  }
  // Fallback — return the URL so the coach can paste it manually.
  return { ok: true, method: "manual", url };
}
