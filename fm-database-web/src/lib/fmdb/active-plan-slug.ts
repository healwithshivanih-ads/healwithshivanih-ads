import "server-only";
import { loadAllPlans } from "./loader";

/**
 * Resolve the currently-published plan slug for a client. Returns the
 * sentinel `"prospect"` when the client has no published plan (so the
 * WhatsApp rollup still has a stable marker — pre-programme messages
 * accumulate in one "[plan: prospect]" thread until a real plan
 * publishes, at which point the next message rolls into a
 * "[plan: <real-slug>]" thread).
 *
 * Tie-breaker when multiple published plans exist (shouldn't happen
 * post-auto-supersede, but defensive): latest version, then latest
 * updated_at.
 */
export async function getActivePlanSlugForClient(
  clientId: string,
): Promise<string> {
  if (!clientId) return "prospect";
  const plans = (await loadAllPlans()) as Array<Record<string, unknown>>;
  const published = plans
    .filter(
      (p) =>
        p.client_id === clientId &&
        ((p.status as string) ?? (p._bucket as string)) === "published",
    )
    .sort((a, b) => {
      const av = (a.version as number) ?? 0;
      const bv = (b.version as number) ?? 0;
      if (av !== bv) return bv - av;
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
  if (published.length === 0) return "prospect";
  return (published[0].slug as string) || "prospect";
}
