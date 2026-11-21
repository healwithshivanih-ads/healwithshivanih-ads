"use server";

/**
 * Body age report (coach-side): build one person's report PDF and the email it arrives in, as DRAFT files.
 *
 * Runs `scripts/body-age-report.py` ($0, no API, no sends). The script itself refuses a real buyer before the
 * launch (Sat 2 Jan 2027, 20:00 IST) and builds the test profile only until then, so this action adds no gate of
 * its own: it passes the script's answer on. Building never emails anyone; `sendBodyAgeReport` below does, on the coach's click only.
 *
 * `record: true` also writes the report to the person's record (report entry, the 14-day Foundation credit, the
 * segment). Leave it off for a look; turn it on for the one that is actually going out. With it on, this action
 * also makes sure their personal link exists before the build and, when the report offers the session, puts the
 * record on the public server afterwards so the pay page shows the price the report quotes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runShim } from "@/lib/fmdb/shim";
import { resolvePersonDir } from "@/lib/fmdb/person-dir";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { clientMailer } from "@/lib/fmdb/mail-from";
import { decideSend, lastSend, type BodyAgeSummary, type SendLogEntry } from "@/lib/fmdb/body-age-send";
import {
  summaryToView,
  toBodyAgeView,
  type BodyAgeKind,
  type BodyAgeResult,
  type BodyAgeShimResult,
  type BodyAgeView,
} from "@/lib/fmdb/body-age-report-view";

const SAFE_ID = /^[\w-]+$/;

export async function buildBodyAgeReport(
  clientId: string,
  kind: BodyAgeKind,
  record = false,
): Promise<BodyAgeResult> {
  if (!/^[\w-]+$/.test(clientId)) return { ok: false, error: "bad client id" };
  if (kind !== "standard" && kind !== "deeper") return { ok: false, error: "kind must be standard or deeper" };
  try {
    // The report prints the person's own session pay link, which needs their link token. Make sure it exists
    // before the build that is going out, so the coach never has to "open the pay link, then build again".
    if (record) {
      const { ensureClientAppToken } = await import("./app-token");
      await ensureClientAppToken(clientId).catch(() => null); // a failure shows up as the script's own blocker
    }
    // Chrome renders the PDF and the email images: allow three minutes.
    const raw = (await runShim("body-age-report.py", { client_id: clientId, kind, record }, 180_000)) as BodyAgeShimResult;
    const view = toBodyAgeView(clientId, kind, raw);
    if (!view.ok) return view;
    // The pay page is on the public server and reads the 14-day price from the record there. The script has just
    // written that price's dates, so put the record on the public server now (the same step as the Foundation
    // pay-link button). Only for someone who has not signed up: a client in care is already there.
    if (record && view.outcome === "foundation" && !(await hasSignedUp(clientId))) {
      const { startFoundationSession } = await import("./foundation-session");
      const staged = await startFoundationSession(clientId).catch(() => ({ ok: false as const }));
      if (!staged.ok) {
        view.warnings.push(
          "Saved, but their session pay page could not be prepared. Open the Foundation pay link on their page once before you send.",
        );
      }
    }
    // A rebuild keeps the report number, so an earlier send of it still shows.
    const last = lastSend(await readJson<unknown>(path.join(reportDir(clientId, view.reportNo), "sent.json")));
    return { ...view, sentAt: last?.sent_at ?? null, sentTo: last?.to ?? null, sentTest: last?.test === true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the report could not be built" };
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────
//
// The ONLY way a report email leaves the app is `sendBodyAgeReport`, called from the coach's click on the card.
// No cron, webhook or other action calls it. The rules (who it may go to, and when) are in body-age-send.ts.

function reportDir(clientId: string, reportNo: string): string {
  return path.join(resolvePersonDir(clientId), "files", "body-age", reportNo);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function recordedReportNos(clientId: string): Promise<{ nos: string[]; email: string | null }> {
  const c = (await loadClientById(clientId)) as Record<string, unknown> | null;
  const list = Array.isArray(c?.body_age_reports) ? (c.body_age_reports as unknown[]) : [];
  const nos = list
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).report_no : null))
    .filter((n): n is string => typeof n === "string");
  return { nos, email: typeof c?.email === "string" ? c.email : null };
}

async function hasSignedUp(clientId: string): Promise<boolean> {
  const c = (await loadClientById(clientId)) as Record<string, unknown> | null;
  return c?.engagement_status === "signed_up";
}

async function viewOf(clientId: string, reportNo: string): Promise<BodyAgeView | null> {
  const dir = reportDir(clientId, reportNo);
  const summary = await readJson<BodyAgeSummary>(path.join(dir, "report.json"));
  const { nos } = await recordedReportNos(clientId);
  return summaryToView(clientId, summary, nos.includes(reportNo), lastSend(await readJson<unknown>(path.join(dir, "sent.json"))));
}

/** The most recently built report for this person, as the card shows it (with whether it was sent). */
export async function latestBodyAgeReport(clientId: string): Promise<BodyAgeView | null> {
  if (!SAFE_ID.test(clientId)) return null;
  const base = path.join(resolvePersonDir(clientId), "files", "body-age");
  let newest: { no: string; at: number } | null = null;
  try {
    for (const no of await fs.readdir(base)) {
      if (!SAFE_ID.test(no)) continue;
      const st = await fs.stat(path.join(base, no, "report.json")).catch(() => null);
      if (st && (!newest || st.mtimeMs > newest.at)) newest = { no, at: st.mtimeMs };
    }
  } catch {
    return null; // no report has ever been built for them
  }
  return newest ? viewOf(clientId, newest.no) : null;
}

/**
 * Email one built report: the approved email as the body, its two images inline, the PDF attached.
 * Coach's click only. Before the launch this sends the test profile's report to the coach's own mailbox and
 * refuses everyone else (body-age-send.ts::decideSend). Every send is written to <report folder>/sent.json, which
 * is what the card reads back to show "Sent".
 */
export async function sendBodyAgeReport(
  clientId: string,
  reportNo: string,
): Promise<{ ok: true; view: BodyAgeView } | { ok: false; error: string }> {
  if (!SAFE_ID.test(clientId) || !SAFE_ID.test(reportNo)) return { ok: false, error: "bad id" };
  const dir = reportDir(clientId, reportNo);
  const summary = await readJson<BodyAgeSummary>(path.join(dir, "report.json"));
  const rec = await recordedReportNos(clientId);
  const verdict = decideSend({
    clientId,
    nowMs: Date.now(),
    summary,
    recordedReportNos: rec.nos,
    recordEmail: rec.email,
    coachEmail: clientMailer()?.user ?? null,
  });
  if (!verdict.ok) return verdict;

  const attachment = summary!.attachment!;
  if (attachment.includes("/") || attachment.includes("..")) return { ok: false, error: "The report files are incomplete. Build it again." };
  let html: Buffer, pdf: Buffer, ring: Buffer, mark: Buffer;
  try {
    [html, pdf, ring, mark] = await Promise.all(
      ["email.html", attachment, "ring.png", "mark.png"].map((n) => fs.readFile(path.join(dir, n))),
    );
  } catch {
    return { ok: false, error: "A file of this report is missing. Build it again, then send." };
  }

  const { sendClientEmailAction } = await import("@/app/api/email/actions");
  const sent = await sendClientEmailAction({
    to: verdict.to,
    purpose: "transactional",
    clientId,
    subject: summary!.subject!,
    htmlBody: html.toString("utf8"),
    attachments: [
      { filename: "ring.png", contentBase64: ring.toString("base64"), mimeType: "image/png", cid: "ring" },
      { filename: "mark.png", contentBase64: mark.toString("base64"), mimeType: "image/png", cid: "mark" },
      { filename: attachment, contentBase64: pdf.toString("base64"), mimeType: "application/pdf" },
    ],
  });
  if (!sent.ok) return { ok: false, error: `The email did not go: ${sent.error}` };

  const logFile = path.join(dir, "sent.json");
  const prior = await readJson<unknown>(logFile);
  const entry: SendLogEntry = { sent_at: new Date().toISOString(), to: verdict.to, test: verdict.test };
  await fs.writeFile(logFile, JSON.stringify([...(Array.isArray(prior) ? prior : []), entry], null, 1), "utf8");
  const view = await viewOf(clientId, reportNo);
  if (!view) return { ok: false, error: "Sent, but the report could not be read back. Reload the page." };
  return { ok: true, view };
}
