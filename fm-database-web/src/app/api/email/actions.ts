"use server";

import { execFile as execFileCb } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import { revalidatePath } from "next/cache";
import yaml from "js-yaml";
import { getPlansRoot } from "@/lib/fmdb/paths";

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

// ── Send email via nodemailer ──────────────────────────────────────────────

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
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
    await transporter.sendMail({
      from: `FM Coach <${user}>`,
      to: input.to,
      subject: input.subject,
      html: input.htmlBody,
      text: input.textBody,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
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
      With care,<br/>Shivani
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
      from: `Shivani Hariharan, FM Health Coach <${user}>`,
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
    revalidatePath("/clients");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
