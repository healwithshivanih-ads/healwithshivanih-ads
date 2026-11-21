/**
 * The rules for sending a body age report by email. Pure (no fs, no server-only) so the tests can pin them.
 *
 * Nothing here sends anything: `decideSend` only answers "may this report go, and to which address". The send
 * itself is `server-actions/body-age-report.ts::sendBodyAgeReport`, and only the coach's own click reaches it.
 *
 * Until the launch (Sat 2 Jan 2027, 20:00 IST) the only report that can be sent is the test profile's, and that one
 * ALWAYS goes to the coach's own mailbox, never to an address on the record. After the launch the test profile
 * still goes to the coach; a real buyer's report goes to the email on their record, and only once the report has
 * been saved to that record (that is what starts the 14-day session price the report quotes).
 */

export const TEST_PROFILE = "cl-900";
/** Sat 2 Jan 2027, 20:00 IST. Mirrors EMBARGO_UNTIL in scripts/body-age-report.py. */
export const EMBARGO_UNTIL_MS = Date.UTC(2027, 0, 2, 14, 30);

/** What scripts/body-age-report.py leaves in <report folder>/report.json. */
export interface BodyAgeSummary {
  report_no?: string;
  kind?: string;
  outcome?: string;
  report_date?: string;
  name?: string;
  subject?: string;
  attachment?: string;
  ready?: boolean;
  blockers?: string[];
  warnings?: string[];
  pages?: number | null;
}

export interface SendLogEntry {
  sent_at: string;
  to: string;
  /** True when it went to the coach's own mailbox as a test copy. */
  test: boolean;
}

export type SendDecision = { ok: true; to: string; test: boolean } | { ok: false; error: string };

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function decideSend(input: {
  clientId: string;
  nowMs: number;
  summary: BodyAgeSummary | null;
  /** Report numbers saved on the person's record (client.yaml#body_age_reports). */
  recordedReportNos: string[];
  /** The email on the person's record. */
  recordEmail: string | null | undefined;
  /** The mailbox the app sends from: where a test copy goes. */
  coachEmail: string | null | undefined;
}): SendDecision {
  const s = input.summary;
  if (!s || !s.report_no) return { ok: false, error: "This report has not been built yet. Build it first." };
  if (s.ready !== true) {
    return { ok: false, error: "This report is not ready to send. Build it again and clear what is listed under it." };
  }
  if (!s.attachment || !s.subject) return { ok: false, error: "The report files are incomplete. Build it again." };

  if (input.clientId === TEST_PROFILE) {
    const to = (input.coachEmail ?? "").trim();
    if (!EMAIL.test(to)) return { ok: false, error: "Email is not set up on this Mac, so the test copy has nowhere to go." };
    return { ok: true, to, test: true };
  }
  if (input.nowMs < EMBARGO_UNTIL_MS) {
    return {
      ok: false,
      error: "Reports cannot be sent to anyone before Sat 2 Jan 2027, 8 pm. Until then only the test profile's report can be sent, to your own mailbox.",
    };
  }
  if (!input.recordedReportNos.includes(s.report_no)) {
    return {
      ok: false,
      error: "Save this report to their record first (tick the box and build again). That starts the 14-day session price the report quotes.",
    };
  }
  const to = (input.recordEmail ?? "").trim();
  if (!EMAIL.test(to)) return { ok: false, error: "There is no email address on their record. Add one, then send." };
  return { ok: true, to, test: false };
}

/** The newest entry of a send log, or null. Tolerates a missing or damaged file's parsed value. */
export function lastSend(log: unknown): SendLogEntry | null {
  if (!Array.isArray(log)) return null;
  const ok = log.filter(
    (e): e is SendLogEntry =>
      !!e && typeof e === "object" && typeof (e as SendLogEntry).sent_at === "string" && typeof (e as SendLogEntry).to === "string",
  );
  return ok.length ? ok[ok.length - 1] : null;
}
