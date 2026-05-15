/**
 * /messages — Phase 1 stub. Phase 5 will host: WhatsApp unmatched inbox
 * (unmatched messages from the self-hosted WA server webhook),
 * per-client thread view, manual paste capture, message templates editor,
 * mail-merge UI.
 *
 * For now the dashboard banner + per-client Communicate tab cover the
 * paths the coach actually uses today.
 */
import Link from "next/link";
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";

export const dynamic = "force-dynamic";

export default function MessagesStub() {
  return (
    <FmAppShell activeNavId="messages" crumbs={[{ label: "Messages" }]}>
      <FmPageHeader
        title="Messages"
        subtitle="Coming in Phase 5 — WhatsApp unmatched inbox + per-client threads + templates editor."
      />
      <FmPanel>
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
          <h3
            style={{
              fontFamily: "var(--fm-font-display)",
              fontSize: 20,
              margin: "0 0 8px",
              color: "var(--fm-text-primary)",
            }}
          >
            Messages arrives in Phase 5
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              maxWidth: 480,
              margin: "0 auto 20px",
              lineHeight: 1.55,
            }}
          >
            Will surface unmatched WhatsApp messages (the green banner on
            the dashboard) as a proper inbox, plus per-client threads and
            the existing message templates panel.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Link
              href="/dashboard-v2"
              style={{
                padding: "9px 18px",
                background: "var(--fm-surface)",
                color: "var(--fm-text-primary)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-md)",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </FmPanel>
    </FmAppShell>
  );
}
