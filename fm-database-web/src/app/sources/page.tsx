/**
 * /sources — legacy v1 standalone Add-Source page, deprecated.
 *
 * Consolidated into /ingest as the 📚 Add Source tab (per v0.45). The
 * sidebar "Add Source" link was removed in v0.44 but external bookmarks
 * may still hit /sources directly. Bounce them to /ingest.
 *
 * v2 has its own saveSourceAction in src/app/(v2)/ingest/actions.ts —
 * the v1 actions.ts + source-client.tsx are no longer used and have
 * been removed. v1 implementation is preserved in git history.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacySourcesPage(): never {
  redirect("/ingest");
}
