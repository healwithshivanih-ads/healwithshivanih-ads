/**
 * The From address on CLIENT-facing email.
 *
 * Gmail SMTP authenticates as one account but can send as any address that
 * account has verified as a "send-as" alias. So the address a client sees is
 * a separate decision from the mailbox we log into, and this splits them.
 *
 * Why it matters: the app authenticates as a generic operations mailbox, and
 * a client opening a note about their programme from an address they have
 * never seen reads as a mailshot. Set GMAIL_FROM to the address the practice
 * actually corresponds from and nothing else changes.
 *
 * Deliberately NOT used by the internal alert mail (cron digests, integrity
 * warnings, the Cal.com notification). Those go from the coach to herself and
 * should stay on the mailbox that sends them — putting the client-facing
 * address on an automated warning is how it ends up in a client thread.
 */

/** Address clients see. Falls back to the authenticating account. */
export function clientFrom(authUser: string): string {
  const name = process.env.COACH_NAME || "Shivani Hari";
  const addr = (process.env.GMAIL_FROM || "").trim() || authUser;
  return `${name} <${addr}>`;
}
