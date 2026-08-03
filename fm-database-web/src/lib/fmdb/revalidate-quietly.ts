/**
 * revalidatePath that cannot turn a success into a logged failure.
 *
 * The weekly grocery + recipe packs are produced by a fire-and-forget job
 * started during a request (`void (async () => …)()` in weekly-menu.ts). By
 * the time it finishes, the request that spawned it is over — so Next sees
 * the revalidate as happening "during render" of the route that started it
 * and throws. The artifact is already written to disk at that point; the
 * only casualty is the log, which then reads:
 *
 *     [weekly-menu] cl-013: recipe pack threw: Route /dashboard-v2 used
 *     "revalidatePath /clients-v2/cl-013" during render …
 *
 * for four clients whose packs had landed perfectly. That is worse than
 * noise. On 2026-08-02 two clients genuinely lost their packs to a crash,
 * and their log lines were indistinguishable from these — which is most of
 * why the real failure took a full investigation to find. A log that cries
 * wolf on every success is a log nobody can use in an emergency.
 *
 * So: revalidate when there is a render to revalidate, and stay silent when
 * there is not. Nothing is lost by skipping it in a background job — the
 * page reads the artifact from disk on its next load either way.
 */
import { revalidatePath } from "next/cache";

export function revalidateQuietly(...paths: string[]): void {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      // Detached background work: no request context to revalidate. The
      // write already happened; swallowing this is the whole point.
    }
  }
}
