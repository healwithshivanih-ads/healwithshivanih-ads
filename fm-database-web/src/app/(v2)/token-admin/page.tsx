/**
 * /token-admin — coach-facing register of every public bearer URL.
 *
 * The app's whole auth model is "PHI behind a token link" (app, letter,
 * intake, start-date). This page is the single place to see what's live,
 * when it expires, what it unlocks, and to revoke a leaked link.
 *
 * (Codex audit 2026-06-26, finding #4.)
 */
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";
import { listIssuedTokens } from "@/lib/server-actions/token-admin";
import { TokenAdminClient } from "./token-admin-client";

export const dynamic = "force-dynamic";

export default async function TokenAdminPage() {
  const tokens = await listIssuedTokens();
  const live = tokens.filter((t) => t.status === "active" || t.status === "expired").length;

  return (
    <FmAppShell activeNavId="token-admin" crumbs={[{ label: "Token links" }]}>
      <FmPageHeader
        title="Token links"
        subtitle={`Every public link that opens client data. ${live} live · ${tokens.length} total.`}
      />
      {tokens.length === 0 ? (
        <FmPanel>
          <p style={{ margin: 0, color: "var(--fm-text-secondary)", fontSize: 14 }}>
            No tokens issued yet. They appear here once you share an app link, publish a
            plan letter, or send an intake / start-date link.
          </p>
        </FmPanel>
      ) : (
        <TokenAdminClient tokens={tokens} />
      )}
    </FmAppShell>
  );
}
