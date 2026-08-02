/**
 * /m — entry point. Redirects into the tab shell.
 *
 * Kept as a redirect rather than duplicating Today here so there is exactly
 * one Today implementation, and so the PWA start_url (/m/today) and a manual
 * visit to /m land in the same place.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CoachMobileIndex() {
  redirect("/m/today");
}
