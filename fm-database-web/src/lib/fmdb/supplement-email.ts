/**
 * The supplement-notification email — the default channel since 2026-08-09.
 *
 * Coach decision: client notifications go by EMAIL; WhatsApp only when she
 * explicitly asks for it on the send. Email costs nothing per message, carries
 * no 24-hour window and no Meta template approval, and can say the whole thing
 * in one go instead of squeezing into three {{n}} params.
 *
 * Same two inputs as the WhatsApp templates it replaces — `whatChanged` and
 * `why` — so the coach writes one thing and either channel can carry it, and
 * the wording she has already learned to write does not change.
 *
 * Email-safe by construction: inline styles only, no <style> block, no script,
 * no external CSS. Gmail strips all three.
 */

const INK = "#33302A", SAGE = "#3E5641", SAGES = "#5B7360", OCHRE = "#B85C3E",
  PAPER = "#F7F4EC", SHELL = "#FBF3EE", CARD = "#FFFDF8", HAIR = "#DED8C9";
const SERIF = "Georgia,'Times New Roman',serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Preserve the coach's line breaks — she writes these as short lists. */
const para = (s: string) => esc(s).replace(/\n+/g, "<br>");

export interface SupplementEmailInput {
  firstName: string;
  /** "activate" = a phased supplement is now due. "change" = protocol edited. */
  mode: "activate" | "change";
  /** Plain-English what — the coach's own words. */
  whatChanged: string;
  /** Plain-English why — the coach's own words. */
  why: string;
  /** Token-gated supplement order page. */
  orderUrl: string;
  /** The client's /app link, for the footer. */
  appUrl?: string;
  coachName?: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildSupplementEmail(i: SupplementEmailInput): BuiltEmail {
  const coach = i.coachName || "Shivani";
  const isActivate = i.mode === "activate";
  const subject = isActivate
    ? "A new supplement starts this week"
    : "A small change to your supplements";
  const lead = isActivate
    ? "As planned, it's time to start the next supplement in your plan:"
    : "I've made a small change to your supplements:";

  const html = `<div style="margin:0;padding:24px 12px;background:${SHELL};">
<div style="max-width:600px;margin:0 auto;background:${CARD};border:1px solid ${HAIR};border-radius:10px;padding:32px 30px;">
<p style="margin:0 0 4px;font-family:${SERIF};font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:${SAGES};">The Ochre Tree</p>
<h1 style="margin:0 0 20px;font-family:${SERIF};font-size:24px;font-weight:normal;color:${SAGE};">${esc(subject)}</h1>
<p style="margin:0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">Hi ${esc(i.firstName)},</p>
<p style="margin:14px 0 0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">${esc(lead)}</p>
<div style="margin:20px 0 0;padding:16px 18px;background:${PAPER};border-left:3px solid ${OCHRE};border-radius:0 6px 6px 0;">
<p style="margin:0;font-family:${SERIF};font-size:16px;line-height:1.55;color:${INK};">${para(i.whatChanged)}</p>
</div>
<p style="margin:18px 0 0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">${para(i.why)}</p>
<div style="margin:26px 0 0;text-align:center;">
<a href="${esc(i.orderUrl)}" style="display:inline-block;padding:13px 30px;background:${SAGE};color:${CARD};font-family:${SERIF};font-size:16px;text-decoration:none;border-radius:6px;">Order your supplements</a>
</div>
<p style="margin:26px 0 0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">Any questions, just reply.</p>
<p style="margin:20px 0 0;font-family:${SERIF};font-size:16px;line-height:1.62;color:${INK};">Warmly,<br>${esc(coach)}</p>
<hr style="margin:28px 0 0;border:none;border-top:1px solid ${HAIR};">
<p style="margin:14px 0 0;font-family:${SERIF};font-size:13px;line-height:1.5;color:${SAGES};">${esc(coach)} Hari · Functional Health Coach${
    i.appUrl ? `<br><a href="${esc(i.appUrl)}" style="color:${OCHRE};">Open your plan</a>` : ""
  }</p>
</div>
</div>`;

  const text = [
    `Hi ${i.firstName},`,
    "",
    lead,
    "",
    i.whatChanged,
    "",
    i.why,
    "",
    `Order your supplements: ${i.orderUrl}`,
    "",
    "Any questions, just reply.",
    "",
    "Warmly,",
    coach,
    ...(i.appUrl ? ["", `Open your plan: ${i.appUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}
