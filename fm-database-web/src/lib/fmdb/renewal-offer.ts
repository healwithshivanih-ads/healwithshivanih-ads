/**
 * Renewal offers — what an end-of-plan letter asks the client to do, and when
 * it goes out.
 *
 * Pure (no fs, no server-only) so the dashboard panel, the send cron and the
 * tests share one rule.
 *
 * WHEN: two days BEFORE the plan's effective end (coach decision 2026-10-20),
 * so the client has the offer — and, for maintenance, the payment link — while
 * she is still inside the programme, not the morning after it stops. Approving
 * late never back-dates: a letter approved inside the window goes out on the
 * next send run.
 *
 * WHAT: the decision the coach takes on the account.
 *   - maintenance → the send cron mints a live ₹ payment link at send time and
 *     puts it in the email (a link minted at approval could sit for days and
 *     belong to a price that has since changed);
 *   - continue    → the full programme; payment for it runs through the funnel
 *     app, so the letter asks for a call and carries no link;
 *   - letter_only → the letter as written, no link.
 */

export type RenewalOfferKind = "maintenance" | "continue" | "letter_only";

export const RENEWAL_OFFER_KINDS: readonly RenewalOfferKind[] = ["maintenance", "continue", "letter_only"];

export const RENEWAL_OFFER_LABEL: Record<RenewalOfferKind, string> = {
  maintenance: "Maintenance — payment link included",
  continue: "Continue the programme — asks for a call",
  letter_only: "Letter only — no link",
};

/** Days before the effective end the letter sends. */
export const SEND_LEAD_DAYS = 2;

/** Written in a draft where the payment link should go. When it is absent the
 *  link is added as its own paragraph before the sign-off. */
export const PAYMENT_LINK_PLACEHOLDER = "{{payment_link}}";

export function isRenewalOfferKind(v: unknown): v is RenewalOfferKind {
  return typeof v === "string" && (RENEWAL_OFFER_KINDS as readonly string[]).includes(v);
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The date an approved letter sends: SEND_LEAD_DAYS before `endsOn`, but
 *  never earlier than today. */
export function renewalSendDate(endsOn: string, todayYmd: string): string {
  const lead = addDaysYmd(endsOn, -SEND_LEAD_DAYS);
  return lead < todayYmd ? todayYmd : lead;
}

/**
 * Put the payment link into the letter body.
 *
 * Replaces every PAYMENT_LINK_PLACEHOLDER; with none present, inserts a short
 * paragraph before the sign-off ("Warmly," / "With love," …) or, failing that,
 * at the end — so the link is never lost below the signature.
 */
export function withPaymentLink(body: string, link: string, priceLine: string): string {
  if (body.includes(PAYMENT_LINK_PLACEHOLDER)) {
    return body.split(PAYMENT_LINK_PLACEHOLDER).join(link);
  }
  const para = `When you're ready, you can start your maintenance here (${priceLine}):\n${link}`;
  const paras = body.replace(/\r/g, "").trimEnd().split(/\n\s*\n/);
  const signOff = paras.findIndex((p, i) => i > 0 && /^(warmly|warm regards|with love|love|best|regards|thank you)\b/i.test(p.trim()));
  if (signOff > 0) paras.splice(signOff, 0, para);
  else paras.push(para);
  return paras.join("\n\n") + "\n";
}
