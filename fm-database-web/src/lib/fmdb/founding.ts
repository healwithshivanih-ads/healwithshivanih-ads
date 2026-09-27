/**
 * Sequoya "Founding 20" — the rules, as pure functions.
 *
 * The first 20 clients who sign up for Sequoya between 2 and 31 Jan 2027 are
 * founding members. Each one gets:
 *
 *   1. ONE gifted Foundation session for a family member or friend (not
 *      themselves, no cash value, used by 30 Apr 2027). The recipient walks the
 *      same /foundation/<token> → intake → two calls chain as a paying client,
 *      minus the payment. If the recipient joins Sequoya within 7 days of their
 *      SECOND Foundation call, they get the usual ₹12,000 credit.
 *   2. A locked Sequoya+ rate (₹1,50,000) if they continue to six months.
 *      PRIVATE: it lives on the founder's client.yaml and is never projected to
 *      Fly (it is deliberately absent from app-staging-action.py's
 *      _APP_CLIENT_KEYS) or rendered on any client-facing surface.
 *   3. A "Founding member" mark in their client app + on their growing tree.
 *
 * Record shape (client.yaml, Python model fmdb/plan/models.py):
 *   FOUNDER    founding_member: true
 *              founding_joined_on: YYYY-MM-DD
 *              founding_splus_rate_inr: 150000        ← private
 *              founding_gift: { recipient_client_id, issued_on, expires_on }
 *   RECIPIENT  gifted_foundation_session: { gifted_by, gifted_by_name,
 *                issued_on, expires_on, call_1_on, call_2_on, joined_on }
 *
 * The founder's record says WHO got the gift; the recipient's record carries
 * everything about how it is going (calls, joining). Status is always derived
 * from the recipient — one place to write, nothing to keep in sync.
 *
 * No I/O here — the server actions (lib/server-actions/founding.ts) and the
 * public page read/write the records and call these.
 */

/** How many founding places there are. */
export const FOUNDING_PLACES = 20;

/** The Sequoya+ (six-month) rate a founding member is locked in at. PRIVATE. */
export const FOUNDING_SPLUS_RATE_INR = 150000;

/** Last day a gifted Foundation session can be used (its first call held). */
export const FOUNDING_GIFT_EXPIRES_ON = "2027-04-30";

/** Days after the recipient's SECOND Foundation call in which joining Sequoya
 *  still earns the ₹12,000 credit. (A paid Foundation client gets 15 days from
 *  their call — DISCOVERY_CREDIT_WINDOW_DAYS; a gift recipient gets 7.) */
export const GIFT_CREDIT_WINDOW_DAYS = 7;

/** The Foundation-session credit toward the programme. */
export const FOUNDATION_CREDIT_INR = 12000;

/** The founding-member signup window (informational — the coach marks by hand,
 *  and cl-900 is tested outside it, so it is shown, not enforced). */
export const FOUNDING_WINDOW = { from: "2027-01-02", to: "2027-01-31" } as const;

// ── tiny date helpers (UTC YYYY-MM-DD; string compare === chronological) ─────

export function ymdOf(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  return null;
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Doc = Record<string, unknown> | null | undefined;

function sub(doc: Doc, key: string): Record<string, unknown> | null {
  const v = doc?.[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ── founder side ─────────────────────────────────────────────────────────────

export function isFoundingMember(doc: Doc): boolean {
  return doc?.founding_member === true;
}

export interface FoundingGiftIssued {
  recipient_client_id: string;
  issued_on: string;
  expires_on: string;
}

/** The gift a founder has issued, or null. */
export function foundingGiftOf(doc: Doc): FoundingGiftIssued | null {
  const g = sub(doc, "founding_gift");
  const rid = typeof g?.recipient_client_id === "string" ? g.recipient_client_id.trim() : "";
  if (!g || !rid) return null;
  return {
    recipient_client_id: rid,
    issued_on: ymdOf(g.issued_on) ?? "",
    expires_on: ymdOf(g.expires_on) ?? FOUNDING_GIFT_EXPIRES_ON,
  };
}

// ── recipient side ───────────────────────────────────────────────────────────

export interface GiftedFoundationSession {
  gifted_by: string;
  gifted_by_name: string;
  issued_on: string;
  expires_on: string;
  call_1_on: string | null;
  call_2_on: string | null;
  joined_on: string | null;
}

/** The gifted Foundation session this client received, or null. */
export function giftedSessionOf(doc: Doc): GiftedFoundationSession | null {
  const g = sub(doc, "gifted_foundation_session");
  const by = typeof g?.gifted_by === "string" ? g.gifted_by.trim() : "";
  if (!g || !by) return null;
  return {
    gifted_by: by,
    gifted_by_name: typeof g.gifted_by_name === "string" ? g.gifted_by_name.trim() : "",
    issued_on: ymdOf(g.issued_on) ?? "",
    expires_on: ymdOf(g.expires_on) ?? FOUNDING_GIFT_EXPIRES_ON,
    call_1_on: ymdOf(g.call_1_on),
    call_2_on: ymdOf(g.call_2_on),
    joined_on: ymdOf(g.joined_on),
  };
}

/** A gift is expired once its expiry day has passed without the first call
 *  having happened. Once the first call is held it has been used. */
export function giftExpired(g: GiftedFoundationSession, todayYmd: string): boolean {
  if (g.call_1_on) return false;
  return todayYmd > g.expires_on;
}

/** Last day the recipient can join and still get the ₹12,000 credit (null
 *  until the second call is on record). */
export function giftCreditDeadline(g: GiftedFoundationSession): string | null {
  return g.call_2_on ? addDaysYmd(g.call_2_on, GIFT_CREDIT_WINDOW_DAYS) : null;
}

/** Did/does joining earn the credit? null = not decidable yet (no second call). */
export function giftCreditApplies(g: GiftedFoundationSession, joinedOnYmd: string): boolean | null {
  const deadline = giftCreditDeadline(g);
  if (!deadline) return null;
  return joinedOnYmd <= deadline;
}

/**
 * The credit window the recipient's app / the coach cards should use.
 * Gift recipients: anchored on the SECOND call, 7 days (null anchor before it
 * → "credit live" without a countdown). Everyone else: discovery_call_date,
 * 15 days — the long-standing rule.
 */
export function creditWindowFor(doc: Doc, defaultDays: number): { anchor: string | null; days: number } {
  const g = giftedSessionOf(doc);
  if (g) return { anchor: g.call_2_on, days: GIFT_CREDIT_WINDOW_DAYS };
  return { anchor: ymdOf(doc?.discovery_call_date), days: defaultDays };
}

export type GiftStatus =
  | "issued"
  | "intake_done"
  | "call_1_done"
  | "call_2_done"
  | "joined"
  | "expired";

export interface GiftProgress {
  status: GiftStatus;
  label: string;
  creditDeadline: string | null;
  /** When joined: whether the ₹12,000 credit applies (null if undecidable). */
  creditApplies: boolean | null;
}

/** Where a gift recipient is, for the founder card. `recipient` is the
 *  recipient's client.yaml. */
export function giftProgress(recipient: Doc, todayYmd: string): GiftProgress | null {
  const g = giftedSessionOf(recipient);
  if (!g) return null;
  const creditDeadline = giftCreditDeadline(g);
  const signedUp =
    typeof recipient?.engagement_status === "string" &&
    recipient.engagement_status.trim().toLowerCase() === "signed_up";
  if (g.joined_on || signedUp) {
    const applies = g.joined_on ? giftCreditApplies(g, g.joined_on) : null;
    return {
      status: "joined",
      label:
        applies === true
          ? `Joined Sequoya ${g.joined_on} — ₹12,000 credit applies`
          : applies === false
            ? `Joined Sequoya ${g.joined_on} — after the credit window, no credit`
            : "Joined Sequoya",
      creditDeadline,
      creditApplies: applies,
    };
  }
  if (g.call_2_on) {
    return {
      status: "call_2_done",
      label: `Second call ${g.call_2_on} · credit if they join by ${creditDeadline}`,
      creditDeadline,
      creditApplies: null,
    };
  }
  if (g.call_1_on) {
    return { status: "call_1_done", label: `First call ${g.call_1_on}`, creditDeadline, creditApplies: null };
  }
  if (giftExpired(g, todayYmd)) {
    return { status: "expired", label: `Expired ${g.expires_on} (unused)`, creditDeadline, creditApplies: null };
  }
  if (ymdOf(recipient?.intake_submitted_at)) {
    return { status: "intake_done", label: "Intake received", creditDeadline, creditApplies: null };
  }
  return { status: "issued", label: `Issued ${g.issued_on} · use by ${g.expires_on}`, creditDeadline, creditApplies: null };
}

// ── issuing ──────────────────────────────────────────────────────────────────

/**
 * Can this founder gift a Foundation session to this recipient today? Returns
 * the refusal reason, or null when it may go ahead. `recipient` is the
 * recipient's client.yaml (null for a brand-new person about to be created).
 */
export function giftRefusal(opts: {
  founderId: string;
  founder: Doc;
  recipientId: string | null;
  recipient: Doc;
  recipientHasPaidFoundation: boolean;
  recipientHasPublishedPlan: boolean;
  todayYmd: string;
}): string | null {
  const { founder, recipient } = opts;
  if (!isFoundingMember(founder)) return "only a founding member can gift a Foundation session";
  if (foundingGiftOf(founder)) return "this founding member has already gifted their Foundation session (one per founder)";
  if (opts.todayYmd > FOUNDING_GIFT_EXPIRES_ON) return `founding gifts closed on ${FOUNDING_GIFT_EXPIRES_ON}`;
  if (opts.recipientId && opts.recipientId === opts.founderId) {
    return "the gift is for a family member or friend — not the founder themselves";
  }
  if (recipient) {
    if (giftedSessionOf(recipient)) return "this person has already been gifted a Foundation session";
    if (isFoundingMember(recipient)) return "this person is a founding member themselves";
    if (opts.recipientHasPaidFoundation) return "this person has already paid for a Foundation session";
    if (opts.recipientHasPublishedPlan) return "this person is already on a programme";
    const es = typeof recipient.engagement_status === "string" ? recipient.engagement_status.trim() : "";
    if (es === "signed_up") return "this person has already signed up";
  }
  return null;
}

export function firstNameOf(doc: Doc, fallback = "there"): string {
  const name =
    (typeof doc?.display_name === "string" && doc.display_name.trim()) ||
    (typeof doc?.name === "string" && (doc.name as string).trim()) ||
    "";
  return name.split(/\s+/)[0] || fallback;
}

/** The WhatsApp message the founder forwards to the person they are gifting.
 *  Never mentions a price — a gift has none. */
export function giftMessage(opts: { founderFirst: string; recipientFirst: string; url: string; expiresOn: string }): string {
  const by = new Date(`${opts.expiresOn}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    `Hi ${opts.recipientFirst}! ${opts.founderFirst} has gifted you a Foundation session with ` +
    `Shivani Hari — a proper first look at your health, over two calls: your full history first, ` +
    `then a review of your labs.\n\n` +
    `Here's your link:\n${opts.url}\n\n` +
    `It walks you through a short health form and booking your first call. ` +
    `Please use it by ${by}. — Shivani`
  );
}

/** The founding-member count across a list of client records. */
export function countFoundingMembers(docs: ReadonlyArray<Doc>): number {
  return docs.filter(isFoundingMember).length;
}
