/**
 * Tell the coach a client just filled in the programme feedback form.
 *
 * The form is answered at most three times per client (midpoint, graduation,
 * follow-up), so every answer is worth hearing about the moment it lands —
 * before this, answers sat in the 💬 How are we doing panel until she happened
 * to open the dashboard (Nazneen's graduation answers, 20 Oct 2026).
 *
 * Email carries the whole answer, so she can read it on her phone without
 * opening the app. A push goes too, to any device she has registered. Both are
 * best-effort: a failed notification must never fail the client's submit.
 *
 * Runs where the form is submitted — Fly — which has the Gmail secrets. Links
 * point at the PUBLIC coach host, never NEXT_PUBLIC_APP_URL (the Fly intake
 * host, which 404s every coach route).
 */
import { loadClientById } from "./loader-extras";
import { sendPushToCoach } from "./coach-push";
import {
  FEEDBACK_PARTS,
  GOAL_CHANGE,
  type FeedbackResponse,
  type FeedbackStage,
} from "./programme-feedback";

const STAGE_LABEL: Record<FeedbackStage, string> = {
  midpoint: "halfway feedback",
  graduation: "end-of-programme feedback",
  followup: "3-month follow-up feedback",
};

const CONSENT_LABEL: Record<FeedbackResponse["testimonial"], string> = {
  named: "Yes — may be quoted with their first name",
  anonymous: "Yes — may be quoted anonymously",
  no: "No — keep private",
};

function coachBase(): string {
  return (process.env.COACH_PUBLIC_URL || "https://fmcoach.shivanihari.com").replace(/\/$/, "");
}

function changeLabel(v: number | null): string {
  return GOAL_CHANGE.find((c) => c.v === v)?.label ?? "—";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The email, as plain text and HTML. Pure, so it can be tested. */
export function feedbackEmail(
  name: string,
  clientId: string,
  r: FeedbackResponse,
  base = coachBase(),
): { subject: string; text: string; html: string } {
  const first = name.split(" ")[0] || name;
  const subject =
    `💬 ${name} sent ${STAGE_LABEL[r.stage]}` +
    (r.recommend != null ? ` — would recommend ${r.recommend}/10` : "");
  const link = `${base}/clients-v2/${clientId}`;

  const goals = r.goals.filter((g) => g.change != null);
  const parts = FEEDBACK_PARTS.filter((p) => r.parts[p.id] != null).map((p) => ({
    label: p.id === "app" ? "The app" : p.label,
    score: r.parts[p.id] as number,
  }));
  const words: [string, string][] = (
    [
      ["Biggest change", r.biggest_change],
      ["Hardest part", r.hardest],
      ["One thing they'd change", r.change_one_thing],
    ] as [string, string][]
  ).filter(([, v]) => v.trim());
  const consent = r.stage === "midpoint" ? null : CONSENT_LABEL[r.testimonial];

  const text: string[] = [`${name} sent ${STAGE_LABEL[r.stage]} from the app.`, ""];
  if (r.recommend != null) text.push(`Would recommend: ${r.recommend}/10`, "");
  if (goals.length) {
    text.push("THEIR GOALS:");
    text.push(...goals.map((g) => `  - ${g.goal}: ${changeLabel(g.change)}`), "");
  }
  if (parts.length) {
    text.push("PARTS OF THE PROGRAMME (1–5):");
    text.push(...parts.map((p) => `  - ${p.label}: ${p.score}/5`), "");
  }
  for (const [label, v] of words) text.push(`${label.toUpperCase()}:`, `  ${v.trim()}`, "");
  if (consent) text.push(`Testimonial: ${consent}`, "");
  text.push(`Open ${first}: ${link}`);

  const li = (s: string) => `<li style="margin:2px 0;">${s}</li>`;
  const ul = (items: string[]) =>
    `<ul style="margin:4px 0 0;padding-left:20px;">${items.map(li).join("")}</ul>`;
  const blocks: string[] = [];
  if (r.recommend != null) {
    blocks.push(`<p style="margin:14px 0 0;"><strong>Would recommend:</strong> ${r.recommend}/10</p>`);
  }
  if (goals.length) {
    blocks.push(
      `<p style="margin:14px 0 0;"><strong>Their goals</strong>${ul(
        goals.map((g) => `${esc(g.goal)} — <strong>${esc(changeLabel(g.change))}</strong>`),
      )}</p>`,
    );
  }
  if (parts.length) {
    blocks.push(
      `<p style="margin:14px 0 0;"><strong>Parts of the programme</strong>${ul(
        parts.map((p) => `${esc(p.label)}: ${p.score}/5`),
      )}</p>`,
    );
  }
  for (const [label, v] of words) {
    blocks.push(
      `<p style="margin:14px 0 0;"><strong>${esc(label)}</strong><br>` +
        `<span style="white-space:pre-wrap;">${esc(v.trim())}</span></p>`,
    );
  }
  if (consent) {
    blocks.push(`<p style="margin:14px 0 0;color:#5c6378;font-size:14px;">Testimonial: ${esc(consent)}</p>`);
  }
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#2b2d42;line-height:1.55;max-width:600px;">
  <p style="margin:0 0 4px;font-size:17px;"><strong>${esc(name)}</strong> sent ${esc(STAGE_LABEL[r.stage])}.</p>
  <p style="margin:0;color:#8d99ae;font-size:13px;">${esc(clientId)} · week ${r.week}</p>
  ${blocks.join("\n  ")}
  <p style="margin:22px 0 0;">
    <a href="${link}" style="display:inline-block;background:#2b2d42;color:#fff;text-decoration:none;padding:9px 16px;border-radius:4px;font-size:14px;">Open ${esc(first)}</a>
  </p>
  <p style="margin:24px 0 0;color:#8d99ae;font-size:12px;">Automated from your FM coach app · all answers are on the dashboard under 💬 How are we doing.</p>
</div>`;

  return { subject, text: text.join("\n"), html };
}

export async function notifyCoachOfFeedback(
  clientId: string,
  response: FeedbackResponse,
): Promise<{ email: string; push: string }> {
  let name = clientId;
  try {
    const c = (await loadClientById(clientId)) as { display_name?: string } | null;
    if (c?.display_name) name = c.display_name;
  } catch {
    // A notification with a client code still beats no notification.
  }
  const { subject, text, html } = feedbackEmail(name, clientId, response);

  let email = "skipped (no GMAIL_USER / GMAIL_APP_PASSWORD)";
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (user && pass) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({ service: "gmail", auth: { user, pass } });
      await transporter.sendMail({
        from: `${process.env.COACH_NAME || "Shivani Hari"} <${user}>`,
        to: process.env.COACH_DIGEST_EMAIL || user,
        subject,
        text,
        html,
      });
      email = "sent";
    } catch (e) {
      email = `err: ${(e as Error).message}`;
      console.error("[feedback-notify] email failed:", e);
    }
  }

  let push = "none";
  try {
    const { sent } = await sendPushToCoach({
      title: `${name.split(" ")[0]} sent feedback`,
      body: response.recommend != null ? `Would recommend ${response.recommend}/10` : STAGE_LABEL[response.stage],
      url: `/m/clients/${clientId}`,
      tag: `feedback-${clientId}`,
    });
    push = sent > 0 ? "sent" : "no coach device registered";
  } catch (e) {
    push = `err: ${(e as Error).message}`;
  }

  return { email, push };
}
