"use server";

import { execFile as execFileCb } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { dumpYaml } from "@/lib/fmdb/yaml-dump";
import { getPlansRoot } from "@/lib/fmdb/paths";

/** Calendar date (YYYY-MM-DD) of an ISO timestamp in IST (Asia/Kolkata, +05:30). */
function istDateOnly(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Send log re-restored 2026-05-19 — the new V2 Communicate panel needs
// to distinguish Drafted (file on disk) from Sent (email actually went
// out). File lives at ~/fm-plans/clients/<id>/meal-plans/_send_log.yaml
// and is an append-only list of {sent_at, letter_types, to, cc?, plan_slug?}.
// Supports backdating via the optional `sentAt` arg on
// recordLetterSendAction — used when retroactively marking a letter as
// having been sent on an earlier date (e.g. client already received the
// initial package outside the app).
export interface LetterSendEntry {
  sent_at: string;
  letter_types: string[];
  to: string;
  cc?: string;
  plan_slug?: string;
  // Fortnight range for phase (meal_plan_phase) letters, so a "Sent" badge
  // attaches to the RIGHT fortnight instead of every phase letter sharing the
  // latest meal_plan_phase send (coach bug 2026-06-05: wk5-6 showed the wk3-4
  // send date). Absent on non-phase letters and on pre-2026-06-05 entries.
  phase_start?: number;
  phase_end?: number;
}

function sendLogPath(clientId: string): string {
  return path.join(
    getPlansRoot(),
    "clients",
    clientId,
    "meal-plans",
    "_send_log.yaml",
  );
}

export async function loadLetterSendLogAction(
  clientId: string,
): Promise<LetterSendEntry[]> {
  if (!clientId) return [];
  try {
    const raw = await fs.readFile(sendLogPath(clientId), "utf-8");
    const parsed = yaml.load(raw);
    if (!Array.isArray(parsed)) return [];
    // Lenient shape check — drop malformed entries rather than throw.
    return parsed
      .filter(
        (e): e is LetterSendEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as LetterSendEntry).sent_at === "string" &&
          Array.isArray((e as LetterSendEntry).letter_types) &&
          typeof (e as LetterSendEntry).to === "string",
      )
      // Newest first — the panel slices to 8 for the sidebar.
      .sort(
        (a, b) =>
          new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
      );
  } catch {
    return [];
  }
}

export async function recordLetterSendAction(input: {
  clientId: string;
  planSlug: string;
  letterTypes: string[];
  to: string;
  cc?: string;
  /** ISO timestamp. Defaults to now. Pass a past ISO to backdate (e.g.
   *  "2026-05-12T18:00:00+05:30" when marking an old initial-package
   *  letter as having been sent at intake). */
  sentAt?: string;
  /** Fortnight range — pass for meal_plan_phase letters so the "Sent" badge
   *  attaches to the correct fortnight (not every phase letter). */
  phaseStart?: number;
  phaseEnd?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    clientId,
    planSlug,
    letterTypes,
    to,
    cc,
    sentAt,
    phaseStart,
    phaseEnd,
  } = input;
  if (!clientId) return { ok: false, error: "clientId required" };
  if (!planSlug) return { ok: false, error: "planSlug required" };
  if (!Array.isArray(letterTypes) || letterTypes.length === 0)
    return { ok: false, error: "letterTypes must be a non-empty array" };
  if (!to) return { ok: false, error: "to required" };

  const filePath = sendLogPath(clientId);
  let existing: LetterSendEntry[] = [];
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = yaml.load(raw);
    if (Array.isArray(parsed)) existing = parsed as LetterSendEntry[];
  } catch {
    /* file may not exist yet — that's fine */
  }

  const entry: LetterSendEntry = {
    sent_at: sentAt || new Date().toISOString(),
    letter_types: letterTypes,
    to,
    ...(cc ? { cc } : {}),
    plan_slug: planSlug,
    ...(typeof phaseStart === "number" ? { phase_start: phaseStart } : {}),
    ...(typeof phaseEnd === "number" ? { phase_end: phaseEnd } : {}),
  };

  // Dedup: don't append an identical entry (same sent_at + types + to).
  // Lets the action be safe to retry.
  const dupe = existing.find(
    (e) =>
      e.sent_at === entry.sent_at &&
      e.to === entry.to &&
      e.letter_types.join(",") === entry.letter_types.join(","),
  );
  if (dupe) {
    revalidatePath(`/clients-v2/${clientId}/communicate`);
    return { ok: true };
  }

  existing.push(entry);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Known limitation (B8 audit 2026-05-19): no file lock around this
    // read-modify-write. If two concurrent sends to the same client
    // race, the later write clobbers the earlier. In practice the
    // dedup check above + the human-paced cadence (rarely <30s apart)
    // mean we haven't observed losses. If automation ever drives this
    // at scale, swap to an atomic-append JSONL format.
    await fs.writeFile(
      filePath,
      dumpYaml(existing, { noRefs: true, lineWidth: 100 }),
      "utf-8",
    );
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // (Letters retired 2026-07-04 — the old meal-letter Day-1 anchor and the
  // app_menu re-sync-clear died with them. Day 1 is set explicitly via the
  // plan start-date flow; app_menu is edited only in the Plan studio.)

  revalidatePath(`/clients-v2/${clientId}/communicate`);
  return { ok: true };
}

const PYTHON = path.resolve(process.cwd(), "..", "fm-database", ".venv/bin/python");
const SCRIPTS_DIR = path.resolve(process.cwd(), "scripts");

function runShim(scriptName: string, payload: unknown, timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFileCb(PYTHON, [path.join(SCRIPTS_DIR, scriptName)], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    child.stdin?.end(JSON.stringify(payload));
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d));
    child.stderr?.on("data", (d: Buffer) => (stderr += d));
    child.on("error", reject);
    child.on("close", () => {
      if (!stdout.trim()) reject(new Error(`No output. stderr: ${stderr.slice(0, 400)}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`JSON parse error. stdout: ${stdout.slice(0, 200)}`)); }
      }
    });
  });
}

// ── Render plan to HTML ────────────────────────────────────────────────────

export interface SendEmailInput {
  to: string;
  cc?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  /** Attachments to ship alongside the email body. Used for the
   *  recipes sidecar HTML on phase letters (and anything else the
   *  caller wants to bundle). `contentBase64` is base64 of the raw
   *  file bytes; the action decodes back to a Buffer before handing
   *  to nodemailer. */
  attachments?: {
    filename: string;
    contentBase64: string;
    mimeType?: string;
    /** Content-ID for inline-embedded images referenced as <img src="cid:…">
     *  (e.g. the welcome-email screenshots). Omit for plain attachments. */
    cid?: string;
  }[];
}

export async function sendClientEmailAction(
  input: SendEmailInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return {
      ok: false,
      error: "Email not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local",
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    const nmAttachments =
      input.attachments && input.attachments.length > 0
        ? input.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.contentBase64, "base64"),
            contentType: a.mimeType,
            cid: a.cid,
          }))
        : undefined;
    await transporter.sendMail({
      from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      html: input.htmlBody,
      text: input.textBody,
      attachments: nmAttachments,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Send a saved phase meal-plan letter to the client ────────────────────────
//
// Phase letters (weeks 3-4, 5-6, etc) sit at
//   ~/fm-plans/clients/<id>/meal-plans/<planSlug>-meal_plan-wk<N>-<M>.html
// SendPackageButton doesn't know about them (it only handles the 5 base
// letter types). This action gives the PhaseLetterPanel a one-click send
// path that doesn't make the coach round-trip through the letter editor.

export interface EducationPackInput {
  clientId: string;
  clientEmail: string;
  clientName?: string;
  topicSlugs: string[];   // selected topic slugs to include
}

export interface EducationPackResult {
  ok: boolean;
  sentTopics?: string[];
  error?: string;
}

export async function sendEducationPackAction(
  input: EducationPackInput
): Promise<EducationPackResult> {
  if (!input.topicSlugs.length) {
    return { ok: false, error: "Select at least one topic." };
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return { ok: false, error: "Email not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local" };
  }

  // Generate briefs for each selected topic (sequentially to avoid rate limits)
  const briefs: Array<{ slug: string; markdown: string }> = [];
  const failures: string[] = [];

  for (const slug of input.topicSlugs) {
    try {
      const result = await runShim(
        "render-topic-brief.py",
        { client_id: input.clientId, topic_slug: slug },
        180_000
      ) as { ok: boolean; markdown?: string; error?: string };

      if (result.ok && result.markdown) {
        briefs.push({ slug, markdown: result.markdown });
      } else {
        failures.push(slug);
      }
    } catch {
      failures.push(slug);
    }
  }

  if (briefs.length === 0) {
    return { ok: false, error: `Could not generate any briefs. Failed: ${failures.join(", ")}` };
  }

  // Convert markdown briefs to HTML sections
  function mdToHtml(md: string): string {
    return md
      .split("\n")
      .map((line) => {
        if (line.startsWith("## ")) return `<h2 style="color:#2B2D42;font-size:1.1rem;margin:24px 0 8px;">${line.slice(3)}</h2>`;
        if (line.startsWith("# "))  return `<h1 style="color:#2B2D42;font-size:1.3rem;margin:0 0 12px;">${line.slice(2)}</h1>`;
        if (line.startsWith("### ")) return `<h3 style="color:#2B2D42;font-size:1rem;margin:16px 0 6px;">${line.slice(4)}</h3>`;
        if (line.startsWith("- ") || line.startsWith("* ")) return `<li style="margin:4px 0;">${mdInline(line.slice(2))}</li>`;
        if (line.trim() === "") return "<br/>";
        return `<p style="margin:6px 0;line-height:1.6;">${mdInline(line)}</p>`;
      })
      .join("\n");
  }

  function mdInline(s: string): string {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#2B2D42;">$1</a>');
  }

  const firstName = input.clientName?.split(" ")[0] ?? "there";
  const topicCount = briefs.length;

  const htmlSections = briefs
    .map(
      (b, i) => `
      <div style="margin-bottom:40px;padding-bottom:32px;${i < briefs.length - 1 ? "border-bottom:1px solid #e5e7eb;" : ""}">
        ${mdToHtml(b.markdown)}
      </div>`
    )
    .join("\n");

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Georgia,serif;max-width:680px;margin:0 auto;padding:32px 24px;color:#333;background:#fff;">
  <div style="margin-bottom:32px;">
    <p style="font-size:0.95rem;line-height:1.7;color:#444;">Hi ${firstName},</p>
    <p style="font-size:0.95rem;line-height:1.7;color:#444;">
      I've put together ${topicCount === 1 ? "an educational brief" : `${topicCount} educational briefs`} on
      ${topicCount === 1 ? "a topic" : "some topics"} relevant to your health journey.
      These are based on trusted medical sources and are designed to help you understand
      what's happening in your body and why the recommendations I've made matter.
    </p>
    <p style="font-size:0.95rem;line-height:1.7;color:#444;">
      Take your time reading through — there's no rush. Feel free to reply if anything
      sparks a question.
    </p>
    <p style="font-size:0.95rem;line-height:1.7;color:#444;margin-top:16px;">
      With care,<br/>${process.env.COACH_NAME || "Shivani"}
    </p>
  </div>
  <hr style="border:none;border-top:2px solid #2B2D42;margin-bottom:32px;"/>
  ${htmlSections}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:32px;"/>
  <p style="font-size:0.75rem;color:#999;margin-top:16px;">
    These briefs are for educational purposes only and are not a substitute for
    personalised medical advice. Please consult your doctor before making any changes
    to your health routine.
  </p>
</body>
</html>`;

  const subjectTopics = briefs
    .map((b) => b.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .slice(0, 3)
    .join(", ");
  const subject =
    topicCount === 1
      ? `Your health brief: ${subjectTopics}`
      : `Your health education pack (${topicCount} topics)`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
      to: input.clientEmail,
      subject,
      html: htmlBody,
    });
    return { ok: true, sentTopics: briefs.map((b) => b.slug) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Update client fields (email, next_contact_date) ───────────────────────

export async function updateClientFieldsAction(
  clientId: string,
  fields: { email?: string; next_contact_date?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const root = getPlansRoot();
    const clientFile = path.join(root, "clients", clientId, "client.yaml");
    const raw = await fs.readFile(clientFile, "utf-8");
    const data = yaml.load(raw) as Record<string, unknown>;

    if (fields.email !== undefined) data.email = fields.email;
    if (fields.next_contact_date !== undefined) {
      if (fields.next_contact_date === null) {
        delete data.next_contact_date;
      } else {
        data.next_contact_date = fields.next_contact_date;
      }
    }
    data.updated_at = new Date().toISOString();

    await fs.writeFile(clientFile, dumpYaml(data), "utf-8");
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}`);
    revalidatePath(`/clients-v2/${clientId}/analyse`);
    revalidatePath("/clients");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
