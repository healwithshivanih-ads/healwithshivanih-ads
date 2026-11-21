/**
 * What a client reads when booking, paying for or rebooking a test fails.
 *
 * The lab routes answer with short machine strings ("order is not payable",
 * "refused: …", "HTTP 500", a JSON parse error). Those must never reach the
 * client. A sentence written for her — a form problem such as a missing
 * pincode, or "you already have an order ready to book" — is shown as it is,
 * with a capital letter. Everything else becomes one plain line.
 */

const TRY_AGAIN = "That didn't go through. Check your connection and try again, or message your coach.";

/** Machine strings: technical, internal, or meaningless to a client. */
const TECHNICAL =
  /\b(http|json|unexpected token|fetch|network|load failed|not configured|unavailable|bad (id|json|signature|token)|not found|not payable|refused|unauthori[sz]ed|forbidden|invalid token|token|could not start payment|payment failed|could not rebook|couldn't load|server|undefined|null|\d{3})\b/i;

export function labErrorWords(raw: unknown, fallback = TRY_AGAIN): string {
  const msg = typeof raw === "string" ? raw.trim() : raw instanceof Error ? raw.message.trim() : "";
  if (!msg) return fallback;
  if (/too many attempts/i.test(msg)) return "You have tried a few times today. Please try again tomorrow, or message your coach.";
  if (/payment is unavailable/i.test(msg)) return "Payment isn't working right now. Please try again in a little while, or message your coach.";
  if (TECHNICAL.test(msg)) return fallback;
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}
