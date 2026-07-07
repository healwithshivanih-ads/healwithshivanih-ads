/**
 * /app/<token> — the client companion app ("The Ochre Tree").
 *
 * Token = the plan's letter_token (same public-token posture as
 * /letter/<token>): issued at publish, cleared on revoke, non-guessable.
 * Everything renders from the real published plan + client record.
 */

import { cookies } from "next/headers";
import { loadClientAppData } from "@/lib/fmdb/client-app";
import { logAppOpen } from "@/lib/fmdb/app-opens";
import OchreApp, { OchreAppError } from "./ochre-app";

export const dynamic = "force-dynamic";

export default async function ClientAppPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data = null;
  try {
    // Device timezone pinned by the app shell on first open — all "today" math
    // (menu day, week counter) renders in the client's local day, not IST.
    const deviceTz = (await cookies()).get("ochre_tz")?.value ?? null;
    data = await loadClientAppData(token, { deviceTz });
  } catch (err) {
    console.error("[client-app] failed to assemble app data:", err);
  }
  if (!data) return <OchreAppError />;
  // adoption signal — Fly-only (coach previews on localhost are excluded)
  void logAppOpen(data.clientId);
  return <OchreApp data={data} />;
}
