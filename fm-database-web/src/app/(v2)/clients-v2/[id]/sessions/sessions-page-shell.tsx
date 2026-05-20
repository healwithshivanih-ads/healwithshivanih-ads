/**
 * Sessions-tab shell — identity strip + 6-tab subnav (Sessions active).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { loadClientJourney } from "@/lib/fmdb/client-journey";
import { FmAppShell, FmClientJourneyStrip } from "@/components/fm";
import { HeaderAvatar } from "../analyse/header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import { clientSubnavTabs } from "../client-subnav";

export interface SessionsPageShellProps {
  clientId: string;
  children: React.ReactNode;
}

export async function SessionsPageShell({
  clientId,
  children,
}: SessionsPageShellProps) {
  const client = await loadClientById(clientId);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;
  const tabs = clientSubnavTabs(clientId);
  const todayStr = new Date().toISOString().slice(0, 10);
  const journey = await loadClientJourney(clientId, todayStr);

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(clientId)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: displayName, href: `/clients-v2/${clientId}` },
        { label: "Sessions" },
      ]}
    >
      <FmClientJourneyStrip journey={journey} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          marginBottom: 16,
        }}
      >
        <HeaderAvatar clientId={clientId} displayName={displayName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {displayName}
            <span
              style={{
                fontSize: 11,
                color: "var(--fm-text-tertiary)",
                fontFamily: "var(--fm-font-mono)",
                fontWeight: 500,
                marginLeft: 8,
              }}
            >
              {clientId}
            </span>
          </div>
        </div>
        <Link
          href={`/clients-v2/${clientId}`}
          style={{
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            textDecoration: "none",
            padding: "5px 10px",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          ← Overview
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid var(--fm-border)",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: t.id === "sessions" ? 700 : 500,
              color:
                t.id === "sessions"
                  ? "var(--fm-text-primary)"
                  : "var(--fm-text-tertiary)",
              borderBottom: `2px solid ${t.id === "sessions" ? "var(--fm-primary)" : "transparent"}`,
              textDecoration: "none",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {children}
    </FmAppShell>
  );
}
