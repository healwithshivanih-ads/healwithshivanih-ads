/**
 * What the coach card shows after `scripts/body-age-report.py` has run: the shim's JSON turned into links the
 * browser can open. Pure (no fs, no server-only), so the card and the tests can both import it.
 *
 * The script writes DRAFT files next to the person's record and never emails anyone. `ready: false` means do
 * not send; `blockers` says why in the coach's words.
 */

export type BodyAgeKind = "standard" | "deeper";

export interface BodyAgeShimResult {
  ok: boolean;
  error?: string | null;
  ready?: boolean;
  blockers?: string[];
  drafts?: string[];
  warnings?: string[];
  soon?: string[];
  report?: Record<string, unknown>;
  files?: Record<string, string>;
  pages?: number | null;
  recorded?: boolean;
}

export interface BodyAgeView {
  ok: true;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  /** Results at the strongest level: the report asks them to see a doctor in the next day or two. */
  soon: string[];
  reportNo: string;
  kind: BodyAgeKind;
  outcome: string;
  pages: number | null;
  recorded: boolean;
  pdfUrl: string | null;
  emailUrl: string | null;
  pdfName: string | null;
}

export type BodyAgeResult = BodyAgeView | { ok: false; error: string };

const SAFE_ID = /^[\w-]+$/;
// The PDF is named as the buyer will see the attachment ("Body age report, Name, 4 July 2026.pdf"): spaces and
// commas are fine, a slash or a leading dot is not.
const SAFE_NAME = /^\w[\w .,'()-]*$/;

/** The link for one file of one report, or null when any part is not a plain name. */
export function bodyAgeFileUrl(clientId: string, reportNo: string, filePath: string | undefined): string | null {
  if (!filePath) return null;
  const name = filePath.split("/").pop() ?? "";
  if (!SAFE_ID.test(clientId) || !SAFE_ID.test(reportNo) || !SAFE_NAME.test(name) || name.includes("..")) return null;
  return `/api/body-age-file/${clientId}/${reportNo}/${encodeURIComponent(name)}`;
}

export function toBodyAgeView(clientId: string, kind: BodyAgeKind, raw: BodyAgeShimResult): BodyAgeResult {
  if (!raw || raw.ok !== true) {
    return { ok: false, error: (raw && raw.error) || "the report could not be built" };
  }
  const files = raw.files ?? {};
  // The files sit in <person>/files/body-age/<report no>/, so the folder name IS the report number.
  const anyFile = files.html || files.pdf || files.email_html || "";
  const reportNo = anyFile.split("/").slice(-2, -1)[0] ?? "";
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    ok: true,
    ready: raw.ready === true,
    blockers: raw.blockers ?? [],
    warnings: raw.warnings ?? [],
    soon: raw.soon ?? [],
    reportNo,
    kind,
    outcome: str(raw.report?.outcome),
    pages: typeof raw.pages === "number" ? raw.pages : null,
    recorded: raw.recorded === true,
    pdfUrl: bodyAgeFileUrl(clientId, reportNo, files.pdf),
    emailUrl: bodyAgeFileUrl(clientId, reportNo, files.email_preview ?? files.email_html),
    pdfName: files.pdf ? (files.pdf.split("/").pop() ?? null) : null,
  };
}

/** The outcome in the coach's words. */
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "nothing":
      return "Everything steady: no session offered";
    case "self":
      return "Things they can work on themselves: no session offered";
    case "foundation":
      return "Offers the Foundation session";
    case "doctor_only":
      return "Doctor first: no session offered";
    case "doctor_soon":
      return "See a doctor in the next day or two: no session offered";
    default:
      return outcome || "unknown";
  }
}
