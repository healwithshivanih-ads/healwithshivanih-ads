/**
 * /letter/<token> — RETIRED (letters removed 2026-07-04).
 *
 * Every old WhatsApp/email letter link redirects into the client app:
 * the token is the SAME one /app resolves (plan.letter_token), so the
 * client lands on their live plan instead of a frozen letter.
 */
import { redirect } from "next/navigation";

export default async function LegacyLetterRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/app/${encodeURIComponent(token)}`);
}
