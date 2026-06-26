/**
 * Pure types + flattening for the coach-facing token-admin page.
 *
 * Every public bearer URL in the app is a token (PHI behind a link). This
 * module turns the on-disk client + plan records into one flat, sortable list
 * of issued tokens with a derived status, so the coach has a single place to
 * see what's live and revoke a leaked link.
 *
 * Pure (no fs, no "use server") so it can be unit-tested directly; the
 * server-action layer (token-admin.ts) does the disk reads + revocation.
 */

export type TokenKind = "app" | "letter" | "intake" | "start_confirmation";

export type TokenStatus =
  | "active"
  | "expired"
  | "finalised"
  | "submitted"
  | "used";

export interface IssuedToken {
  kind: TokenKind;
  /** Human label for the kind, e.g. "App link". */
  kindLabel: string;
  clientId: string;
  clientName: string;
  /** Present for plan-level tokens (letter, start_confirmation). */
  planSlug?: string;
  /** Plan bucket for plan-level tokens (e.g. "published"). */
  bucket?: string;
  /** Masked token for display — never the full secret in the list view. */
  tokenMasked: string;
  /** Full public URL, or null when the token has been cleared. */
  url: string | null;
  status: TokenStatus;
  /** ISO/date string or null. */
  expiresAt: string | null;
  createdAt: string | null;
  /** Intake only — first time the client opened the link. */
  firstOpenedAt: string | null;
  /** start_confirmation only — when the client confirmed. */
  usedAt: string | null;
  /** One-line description of what the token unlocks. */
  unlocks: string;
  /** True when the token is live AND a revoke path exists. */
  revocable: boolean;
}

const KIND_LABEL: Record<TokenKind, string> = {
  app: "App link",
  letter: "Plan letter",
  intake: "Intake form",
  start_confirmation: "Start date",
};

const KIND_UNLOCKS: Record<TokenKind, string> = {
  app: "Companion app — full plan, meals, supplements, check-ins (PHI)",
  letter: "Published plan letter (PHI)",
  intake: "Intake form — prefill, draft + submit",
  start_confirmation: "Confirm meal-plan start date",
};

/** Mask a secret to first-6 + last-4 with an ellipsis; short tokens shown whole. */
export function maskToken(token: string): string {
  if (!token) return "—";
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  return "";
}

/** Parse a YAML date/datetime to epoch-ms, or null if unparseable. */
function ms(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function joinUrl(base: string, pathPart: string): string {
  return `${base.replace(/\/+$/, "")}${pathPart}`;
}

export type PlanRecord = Record<string, unknown> & { _bucket?: string };

/**
 * Flatten clients + plans into the issued-token list. `nowMs` is injected so
 * the function stays pure/deterministic for tests. Only rows with something to
 * show are emitted (a live token, or a terminal state like finalised/used).
 */
export function buildIssuedTokens(
  clients: Record<string, unknown>[],
  plans: PlanRecord[],
  baseUrl: string,
  nowMs: number,
): IssuedToken[] {
  const out: IssuedToken[] = [];

  for (const c of clients) {
    const clientId = str(c.client_id) || str(c.id);
    if (!clientId) continue;
    const clientName = str(c.display_name) || clientId;

    // App token — stable, no expiry.
    const appTok = str(c.app_token);
    if (appTok) {
      out.push({
        kind: "app",
        kindLabel: KIND_LABEL.app,
        clientId,
        clientName,
        tokenMasked: maskToken(appTok),
        url: joinUrl(baseUrl, `/app/${appTok}`),
        status: "active",
        expiresAt: null,
        createdAt: str(c.app_token_created_at) || null,
        firstOpenedAt: null,
        usedAt: null,
        unlocks: KIND_UNLOCKS.app,
        revocable: true,
      });
    }

    // Intake token (or a terminal intake state worth surfacing).
    const intakeTok = str(c.intake_token);
    const finalisedAt = str(c.intake_finalised_at);
    const submittedAt = str(c.intake_submitted_at);
    const firstOpened = str(c.intake_first_opened_at) || null;
    if (intakeTok) {
      const expMs = ms(c.intake_token_expires_at);
      const expired = expMs !== null && expMs < nowMs;
      out.push({
        kind: "intake",
        kindLabel: KIND_LABEL.intake,
        clientId,
        clientName,
        tokenMasked: maskToken(intakeTok),
        url: joinUrl(baseUrl, `/intake/${intakeTok}`),
        status: expired ? "expired" : "active",
        expiresAt: str(c.intake_token_expires_at) || null,
        createdAt: null,
        firstOpenedAt: firstOpened,
        usedAt: null,
        unlocks: KIND_UNLOCKS.intake,
        revocable: !expired,
      });
    } else if (finalisedAt || submittedAt) {
      out.push({
        kind: "intake",
        kindLabel: KIND_LABEL.intake,
        clientId,
        clientName,
        tokenMasked: "—",
        url: null,
        status: finalisedAt ? "finalised" : "submitted",
        expiresAt: null,
        createdAt: null,
        firstOpenedAt: firstOpened,
        usedAt: finalisedAt || submittedAt || null,
        unlocks: KIND_UNLOCKS.intake,
        revocable: false,
      });
    }
  }

  for (const p of plans) {
    const bucket = str(p._bucket) || str(p.status);
    const clientId = str(p.client_id);
    const planSlug = str(p.slug);
    if (!clientId || !planSlug) continue;
    const clientName = clientId; // plans don't carry display_name; client list has it

    // Letter token — only meaningful on a published plan.
    const letterTok = str(p.letter_token);
    if (letterTok && bucket === "published") {
      out.push({
        kind: "letter",
        kindLabel: KIND_LABEL.letter,
        clientId,
        clientName,
        planSlug,
        bucket,
        tokenMasked: maskToken(letterTok),
        url: joinUrl(baseUrl, `/letter/${letterTok}`),
        status: "active",
        expiresAt: null,
        createdAt: str(p.letter_token_created_at) || null,
        firstOpenedAt: null,
        usedAt: null,
        unlocks: KIND_UNLOCKS.letter,
        revocable: true,
      });
    }

    // Start-date confirmation token (or the terminal "used" state).
    const startTok = str(p.start_confirmation_token);
    const usedAt = str(p.start_confirmation_used_at);
    if (startTok) {
      const expMs = ms(p.start_confirmation_expires_at);
      const expired = expMs !== null && expMs < nowMs;
      out.push({
        kind: "start_confirmation",
        kindLabel: KIND_LABEL.start_confirmation,
        clientId,
        clientName,
        planSlug,
        bucket,
        tokenMasked: maskToken(startTok),
        url: joinUrl(baseUrl, `/start/${startTok}`),
        status: expired ? "expired" : "active",
        expiresAt: str(p.start_confirmation_expires_at) || null,
        createdAt: null,
        firstOpenedAt: null,
        usedAt: null,
        unlocks: KIND_UNLOCKS.start_confirmation,
        revocable: !expired,
      });
    } else if (usedAt && bucket === "published") {
      out.push({
        kind: "start_confirmation",
        kindLabel: KIND_LABEL.start_confirmation,
        clientId,
        clientName,
        planSlug,
        bucket,
        tokenMasked: "—",
        url: null,
        status: "used",
        expiresAt: null,
        createdAt: null,
        firstOpenedAt: null,
        usedAt,
        unlocks: KIND_UNLOCKS.start_confirmation,
        revocable: false,
      });
    }
  }

  // Live tokens first, then by client name, then kind.
  const liveRank: Record<TokenStatus, number> = {
    active: 0,
    expired: 1,
    submitted: 2,
    finalised: 3,
    used: 4,
  };
  out.sort(
    (a, b) =>
      liveRank[a.status] - liveRank[b.status] ||
      a.clientName.localeCompare(b.clientName) ||
      a.kind.localeCompare(b.kind),
  );
  return out;
}
