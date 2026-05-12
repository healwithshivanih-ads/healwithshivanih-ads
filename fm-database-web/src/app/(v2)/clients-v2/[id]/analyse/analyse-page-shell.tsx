/**
 * Shared layout for /clients-v2/[id]/analyse/<type> routes.
 *
 * Renders the v2 shell + compact client identity strip + 5-tab subnav
 * with Analyse active. Pages plug their form into the children slot.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmAppShell } from "@/components/fm";
import { HeaderAvatar } from "./header-avatar";
import { clientQuickActions } from "../client-quick-actions";

export interface AnalysePageShellProps {
  /** Client id from the route params. */
  clientId: string;
  /** Page-level title shown after the client breadcrumb. */
  formLabel: string;
  /** One-line description appearing in the client strip. */
  formHint?: React.ReactNode;
  children: React.ReactNode;
}

export async function AnalysePageShell({
  clientId,
  formLabel,
  formHint,
  children,
}: AnalysePageShellProps) {
  const client = await loadClientById(clientId);
  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id;

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(clientId)}
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: displayName, href: `/clients-v2/${clientId}` },
        { label: "Analyse", href: `/clients-v2/${clientId}/analyse` },
        { label: formLabel },
      ]}
    >
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
          {formHint && (
            <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              {formHint}
            </div>
          )}
        </div>
        <Link
          href={`/clients-v2/${clientId}/analyse`}
          style={{
            fontSize: 11.5,
            color: "var(--fm-text-secondary)",
            textDecoration: "none",
            padding: "5px 10px",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          ← Picker
        </Link>
      </div>

      {children}
    </FmAppShell>
  );
}
