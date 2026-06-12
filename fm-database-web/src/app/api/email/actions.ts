"use server";

import { execFile as execFileCb } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";
import { buildEmailSafeBody } from "@/lib/email-html";
import { loadPlanBySlug } from "@/lib/fmdb/loader";
import { updatePlanStartDates } from "@/lib/server-actions/plans";

// Letter types that deliver a meal plan to the client. The 12-week clock
// (meal_plan_started_on / Day 1) is anchored to the first of these we send.
const MEAL_BEARING_LETTER_TYPES = new Set([
  "consolidated",
  "meal_plan",
  "meal_plan_phase",
]);

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
      yaml.dump(existing, { noRefs: true, lineWidth: 100 }),
      "utf-8",
    );
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Rule (coach 2026-06-04): the client's 12-week clock starts on the day we
  // send them the first meal plan. If this send includes a meal-plan-bearing
  // letter and the plan has no Day 1 yet, anchor meal_plan_started_on to the
  // EARLIEST meal-bearing send on record (handles out-of-order / backdated
  // recording). Only fires when meal_plan_started_on is still null, so a
  // coach-set or client-confirmed Day 1 is never overwritten.
  if (entry.letter_types.some((t) => MEAL_BEARING_LETTER_TYPES.has(t))) {
    try {
      const plan = await loadPlanBySlug(planSlug);
      const currentDay1 = plan
        ? (plan as Record<string, unknown>).meal_plan_started_on
        : undefined;
      if (plan && !currentDay1) {
        const earliestMealSend = existing
          .filter((e) =>
            (e.letter_types ?? []).some((t) => MEAL_BEARING_LETTER_TYPES.has(t)),
          )
          .map((e) => e.sent_at)
          .filter(Boolean)
          .sort()[0];
        const day1 = istDateOnly(earliestMealSend || entry.sent_at);
        await updatePlanStartDates(planSlug, { meal_plan_started_on: day1 });
      }
    } catch (anchorErr) {
      // Non-fatal — the send still succeeded; coach can set Day 1 manually.
      console.warn("auto meal_plan_started_on anchor failed:", anchorErr);
    }

    // OPTION A re-sync (2026-06-12): the plan's structured app_menu is the
    // app's source of truth, originally migrated from the issued letters.
    // A NEWLY ISSUED meal letter supersedes it — clear app_menu (amendment-
    // logged) so the next app/preview load re-derives from the new letter.
    // Coach dish-edits made on the OLD fortnight are intentionally not
    // carried over (the new letter is a fresh prescription).
    try {
      const dir = path.join(getPlansRoot(), "published");
      const match = (await fs.readdir(dir))
        .filter((n) => n.startsWith(`${planSlug}-v`) && n.endsWith(".yaml"))
        .sort()
        .reverse()[0];
      if (match) {
        const f = path.join(dir, match);
        const doc = (yaml.load(await fs.readFile(f, "utf-8")) as Record<string, unknown>) ?? {};
        if (doc.app_menu) {
          doc.app_menu = null;
          const amendments = Array.isArray(doc.amendments) ? (doc.amendments as unknown[]) : [];
          amendments.push({
            at: new Date().toISOString(),
            by: "system",
            field: "app_menu",
            summary: `Menu re-syncing from the newly issued letter (${entry.letter_types.join(", ")}).`,
          });
          doc.amendments = amendments;
          const tmp = `${f}.tmp-${process.pid}`;
          await fs.writeFile(tmp, yaml.dump(doc, { sortKeys: false, lineWidth: 100 }), "utf-8");
          await fs.rename(tmp, f);
        }
      }
    } catch (syncErr) {
      console.warn("app_menu re-sync clear failed:", syncErr);
    }
  }

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

export async function renderPlanHtmlAction(
  planSlug: string
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    const result = await runShim("plan-render.py", { slug: planSlug, format: "html" }) as Record<string, unknown>;
    if (!result.ok) return { ok: false, error: result.error as string ?? "Render failed" };
    return { ok: true, html: result.content as string };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Load the brand-formatted client letter HTML from disk for use as
 * email body. This is the WARM, narrative, Deep Mind-styled letter
 * (consolidated wellness letter / meal_plan_phase / supplement_plan
 * etc.) — what the client should actually receive, NOT the structured
 * plan dump from renderPlanHtmlAction.
 *
 * Returns {ok:false} if the requested letter type hasn't been generated
 * yet on disk — caller should fall back to renderPlanHtmlAction so the
 * Send modal still works for plans that don't have a saved letter
 * (rare, but possible right after a fresh plan publish).
 *
 * Added 2026-05-19 — coach feedback: the send modal was emailing the
 * unstyled structured plan instead of the brand-formatted letter.
 */
export async function loadLetterHtmlForEmailAction(
  planSlug: string,
  clientId: string,
  letterType:
    | "consolidated"
    | "supplement_plan"
    | "lifestyle_guide"
    | "exercise_plan"
    | "recipes"
    | "meal_plan_phase" = "consolidated",
  phase?: { startWeek: number; endWeek: number } | null,
): Promise<
  {
    ok: true;
    html: string;
    letterType: string;
    savedAt?: string;
    /** Sidecar attachments to ship alongside the main letter body.
     *  Populated when a `<stem>-recipes.html` exists next to the main
     *  letter — phase letters carry the recipe pack as a separate file
     *  so the main letter stays under 7 pages. Encoded as base64 strings
     *  so they can cross the server-action wire safely. */
    attachments?: { filename: string; contentBase64: string; mimeType: string }[];
  }
  | { ok: false; error: string }
> {
  if (!planSlug || !clientId) {
    return { ok: false, error: "planSlug + clientId required" };
  }
  try {
    const root = getPlansRoot();
    // Stem matches letterFileStem in plan-lifecycle.ts:
    //   consolidated → <slug>.html
    //   meal_plan_phase + phase → <slug>-meal_plan-wkN-M.html
    //   others → <slug>-<letterType>.html
    let stem: string;
    if (letterType === "consolidated") {
      stem = planSlug;
    } else if (letterType === "meal_plan_phase" && phase) {
      stem = `${planSlug}-meal_plan-wk${phase.startWeek}-${phase.endWeek}`;
    } else {
      stem = `${planSlug}-${letterType}`;
    }
    const dir = path.join(root, "clients", clientId, "meal-plans");
    const htmlPath = path.join(dir, `${stem}.html`);
    const html = await fs.readFile(htmlPath, "utf-8");
    const stat = await fs.stat(htmlPath);

    // Recipes sidecar — phase letters strip the recipe appendix to a
    // separate file so the main letter stays under 7 pages. When that
    // file exists, attach it to the email. Coach feedback 2026-05-19:
    // "letter said recipes attached but no recipe was attached."
    const attachments: {
      filename: string;
      contentBase64: string;
      mimeType: string;
    }[] = [];
    const recipesPath = path.join(dir, `${stem}-recipes.html`);
    try {
      const recipesBuf = await fs.readFile(recipesPath);
      // Friendly filename for the recipient — uses the human-readable
      // phase label, not the slug-y disk stem.
      const friendlyName =
        letterType === "meal_plan_phase" && phase
          ? phase.startWeek === phase.endWeek
            ? `Recipes — Week ${phase.startWeek}.html`
            : `Recipes — Weeks ${phase.startWeek}–${phase.endWeek}.html`
          : "Recipes.html";
      attachments.push({
        filename: friendlyName,
        contentBase64: recipesBuf.toString("base64"),
        mimeType: "text/html",
      });
    } catch {
      /* no recipes sidecar — that's fine, not all letters have one */
    }

    return {
      ok: true,
      html,
      letterType,
      savedAt: stat.mtime.toISOString(),
      attachments,
    };
  } catch (err) {
    return {
      ok: false,
      error: `No saved ${letterType} letter on disk. Generate it from Communicate first. (${(err as Error).message})`,
    };
  }
}

// ── Send email via nodemailer ──────────────────────────────────────────────

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

// ── Send a client-letter package as inline-rendered email ─────────────────
// Each entry in `letters` is the FULL standalone HTML produced by
// scripts/render-client-letter.py + brand_html.py. We can't drop those
// straight into an email body — the wrappers nest invalidly, fonts via
// @import are blocked by Gmail, scripts are stripped, and the universal
// reset CSS explodes via juice past the ~102KB clip threshold.
// `buildEmailSafeBody` (src/lib/email-html.ts) does all of that cleanup
// per letter; we then wrap the cleaned fragments in a single envelope.
//
// Keeping `sendClientEmailAction` around for callers that already build
// their own htmlBody (sendEducationPackAction etc.).
export interface SendClientLettersInput {
  to: string;
  subject: string;
  intro: string;                        // freeform coach intro (plain text, newline-separated)
  letters: { label: string; html: string }[]; // each `html` is a full standalone letter document
  // Optional rich-HTML attachments — same letters, full standalone version,
  // for the recipient to download and use the per-section print buttons that
  // can't work inside the email body itself (no JS in email clients).
  attachments?: { filename: string; html: string }[];
  cc?: string;
  bcc?: string;
}

export async function sendClientLettersAction(
  input: SendClientLettersInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return {
      ok: false,
      error: "Email not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env.local",
    };
  }

  if (input.letters.length === 0) {
    return { ok: false, error: "No letters selected to send." };
  }

  const introHtml = input.intro
    .split("\n")
    .map((line) =>
      line.trim()
        ? `<p style="margin:6px 0;line-height:1.7;font-family:Georgia,serif;color:#444;">${escapeHtml(line)}</p>`
        : "<br/>",
    )
    .join("\n");

  // Transform each letter into an email-safe fragment, then concatenate.
  const sections = input.letters.map((l) => {
    const safe = buildEmailSafeBody(l.html);
    return `<section style="margin:32px 0;">${safe}</section>`;
  });
  const divider =
    '<hr style="border:none;border-top:2px solid #e5e7eb;margin:40px 0;" />';

  // Per-section print note — only shown when we have attachments (the
  // rich HTML files where the in-page print buttons actually work). The
  // inline view here is for reading; the attachment is for printing.
  const attachmentNote =
    input.attachments && input.attachments.length > 0
      ? `<div style="margin:24px 0;padding:14px 18px;border-left:3px solid #2B2D42;background:#f7f4f3;font-family:Georgia,serif;font-size:14px;line-height:1.6;color:#444;">
  <strong style="color:#2B2D42;">📎 Want to print individual sections?</strong><br/>
  Open the attached file (<em>${escapeHtml(input.attachments.map((a) => a.filename).join(", "))}</em>) — it has 🖨 buttons at the top for each week and the supplement schedule, and prints each on its own page.
</div>`
      : "";

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Georgia,serif;max-width:720px;margin:0 auto;padding:32px 24px;color:#333;background:#fff;">
  <div style="margin-bottom:24px;">${introHtml}</div>
  ${attachmentNote}
  <hr style="border:none;border-top:2px solid #2B2D42;margin-bottom:32px;" />
  ${sections.join(`\n${divider}\n`)}
</body>
</html>`;

  // Map our attachment shape onto nodemailer's. Each one rides as a
  // separate downloadable file; the recipient opens whichever section
  // they want to print.
  const mailAttachments = (input.attachments ?? []).map((a) => ({
    filename: a.filename,
    content: a.html,
    contentType: "text/html; charset=utf-8",
  }));

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
      to: input.to,
      cc: input.cc || undefined,
      bcc: input.bcc || undefined,
      subject: input.subject,
      html: htmlBody,
      attachments: mailAttachments.length > 0 ? mailAttachments : undefined,
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

export interface SendPhaseLetterInput {
  planSlug: string;
  clientId: string;
  startWeek: number;
  endWeek: number;
  /** Defaults to the client's email on file. Coach can override if needed. */
  toEmail?: string;
  /** Defaults to "Your week N-M menu — The Ochre Tree". */
  subject?: string;
  /** Defaults to "Hi <first>, here's your menu for weeks N-M…". */
  intro?: string;
}

export interface SendPhaseLetterResult {
  ok: boolean;
  error?: string;
  sentTo?: string;
}

export async function sendPhaseLetterAction(
  input: SendPhaseLetterInput,
): Promise<SendPhaseLetterResult> {
  if (!input.planSlug || !input.clientId) {
    return { ok: false, error: "Missing planSlug or clientId" };
  }
  if (!Number.isFinite(input.startWeek) || !Number.isFinite(input.endWeek)) {
    return { ok: false, error: "startWeek and endWeek must be numbers" };
  }

  // 1. Load the phase letter HTML — already generated by
  //    generatePhaseMealPlanAction, sits at the per-phase filename.
  const dir = path.join(
    getPlansRoot(),
    "clients",
    input.clientId,
    "meal-plans",
  );
  const stem = `${input.planSlug}-meal_plan-wk${input.startWeek}-${input.endWeek}`;
  let html: string;
  try {
    html = await fs.readFile(path.join(dir, `${stem}.html`), "utf-8");
  } catch {
    return {
      ok: false,
      error: `Phase letter not generated yet (${stem}.html not found). Generate it first via Communicate → 🍽 Generate next weeks' meal plan.`,
    };
  }

  // 2. Resolve recipient: prefer explicit toEmail, else client.email.
  let toEmail = input.toEmail?.trim();
  let firstName = "";
  let coachName = process.env.COACH_NAME || "Shivani";
  if (!toEmail) {
    try {
      const clientYaml = path.join(
        getPlansRoot(),
        "clients",
        input.clientId,
        "client.yaml",
      );
      const raw = await fs.readFile(clientYaml, "utf-8");
      const data = (yaml.load(raw) as Record<string, unknown>) ?? {};
      toEmail = (data.email as string | undefined)?.trim();
      const displayName = (data.display_name as string | undefined) ?? "";
      firstName = displayName.split(" ")[0] ?? "";
      coachName = (data.assigned_coach as string | undefined) || process.env.COACH_NAME || "Shivani";
    } catch {
      /* fall through to error below */
    }
  }
  if (!toEmail) {
    return {
      ok: false,
      error: `No email on file for client ${input.clientId}. Add one on the Overview tab.`,
    };
  }

  // 3. Build defaults — coach can override via UI but the defaults are
  //    safe and consistent across phase sends.
  const range =
    input.startWeek === input.endWeek
      ? `Week ${input.startWeek}`
      : `Weeks ${input.startWeek}–${input.endWeek}`;
  const subject =
    input.subject?.trim() || `Your ${range.toLowerCase()} menu — The Ochre Tree`;
  const intro =
    input.intro?.trim() ||
    `Hi${firstName ? ` ${firstName}` : ""},\n\nHere's your menu for ${range.toLowerCase()} of the protocol. Reply if you'd like any swaps — these are flexible.\n\nWarmly,\n${coachName}`;

  // 4. Use the same sendClientLettersAction the SendPackageButton flow
  //    uses — single source of truth for "what does an email look like".
  const sendResult = await sendClientLettersAction({
    to: toEmail,
    subject,
    intro,
    letters: [{ label: `${range} meal plan`, html }],
  });
  if (!sendResult.ok) return { ok: false, error: sendResult.error };
  return { ok: true, sentTo: toEmail };
}

// ── Generate + send education pack ────────────────────────────────────────

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

    await fs.writeFile(clientFile, yaml.dump(data), "utf-8");
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
