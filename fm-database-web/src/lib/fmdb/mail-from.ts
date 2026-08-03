/**
 * Which mailbox client-facing email is sent from.
 *
 * TWO ACCOUNTS, ON PURPOSE. The app authenticates as a generic operations
 * mailbox for everything automated. But a note about someone's programme
 * arriving from an inbox they have never seen reads as a mailshot at exactly
 * the moment it should read as a letter — so the coach's own working address
 * sends those instead.
 *
 * They are separate Google Workspace accounts, not aliases, so this cannot be
 * a From-header override: the second account has its own credentials and its
 * own SMTP session. GMAIL_USER is deliberately left alone — the ops mailbox
 * keeps doing what it always did.
 *
 * Falls back to the ops account when the coach account is not configured, so
 * a half-finished setup degrades to the old behaviour rather than to no email
 * at all. GMAIL_FROM still works on top, for the case where the chosen
 * account has a verified send-as alias.
 *
 * NOT used by internal alert mail — cron digests, the YAML-integrity warning,
 * the Cal.com notification. Those go from the coach to herself, and putting a
 * client-facing address on an automated warning is how one ends up in a
 * client's thread.
 */

export type MailerCreds = {
  /** SMTP login. */
  user: string;
  pass: string;
  /** Fully-formed From header. */
  from: string;
  /** True when the coach's own account is doing the sending. */
  personal: boolean;
};

/** Address clients see, given the account actually authenticating. */
export function clientFrom(authUser: string): string {
  const name = process.env.COACH_NAME || "Shivani Hari";
  const addr = (process.env.GMAIL_FROM || "").trim() || authUser;
  return `${name} <${addr}>`;
}

/**
 * Credentials for a client-facing send: the coach's own account where it is
 * configured, otherwise the ops mailbox.
 *
 * Returns null only when NEITHER is configured — the caller reports that
 * rather than throwing, because a missing setting should not look like a
 * failed send.
 */
export function clientMailer(): MailerCreds | null {
  const coachUser = (process.env.COACH_GMAIL_USER || "").trim();
  const coachPass = (process.env.COACH_GMAIL_APP_PASSWORD || "").trim();
  if (coachUser && coachPass) {
    return { user: coachUser, pass: coachPass, from: clientFrom(coachUser), personal: true };
  }
  const opsUser = (process.env.GMAIL_USER || "").trim();
  const opsPass = (process.env.GMAIL_APP_PASSWORD || "").trim();
  if (opsUser && opsPass) {
    return { user: opsUser, pass: opsPass, from: clientFrom(opsUser), personal: false };
  }
  return null;
}
