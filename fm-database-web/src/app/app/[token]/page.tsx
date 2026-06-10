/**
 * /app/<token> — the client companion app ("The Ochre Tree").
 *
 * Token = the plan's letter_token (same public-token posture as
 * /letter/<token>): issued at publish, cleared on revoke, non-guessable.
 * Everything renders from the real published plan + client record.
 */

import { loadClientAppData } from "@/lib/fmdb/client-app";
import OchreApp, { OchreAppError } from "./ochre-app";

export const dynamic = "force-dynamic";

export default async function ClientAppPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data = null;
  try {
    data = await loadClientAppData(token);
  } catch (err) {
    console.error("[client-app] failed to assemble app data:", err);
  }
  if (!data) return <OchreAppError />;
  return <OchreApp data={data} />;
}
