/**
 * Plan-tab shell — identity strip + 5-tab subnav (Plan active).
 * Matches the analyse-page-shell pattern so the v2 chrome stays consistent.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmAppShell } from "@/components/fm";
import { HeaderAvatar } from "../analyse/header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import { clientSubnavTabs } from "../client-subnav";

export interface PlanPageShellProps {
  clientId: string;
  children: React.ReactNode;
}

export async function PlanPageShell({
  clientId,
  children,
}: PlanPageShellProps) {
  const client = await loadClientById(clientId);
  if (!client) notFound();
  const displayName = client.display_name ?? client.client_id;

  const tabs = clientSubnavTabs(clientId);

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(clientId)}
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: displayName, href: `/clients-v2/${clientId}` },
        { label: "Plan" },
      ]}
    >
      {/* Compact client identity strip */}
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
            fontSize: 11.5,
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

      {/* 5-tab subnav — Plan active */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid var(--fm-border)",
        }}
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: t.id === "plan" ? 700 : 500,
              color:
                t.id === "plan"
                  ? "var(--fm-text-primary)"
                  : "var(--fm-text-tertiary)",
              borderBottom: `2px solid ${t.id === "plan" ? "var(--fm-primary)" : "transparent"}`,
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
