/**
 * /clients-v2/[id]/analyse/quick — v2 Quick Note form.
 *
 * Simplest of the 5 session types. Single textarea + source chip + save.
 * Wraps the existing saveSessionAction so saves land on the same YAML as
 * the legacy flow.
 */
import { notFound } from "next/navigation";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmAppShell, FmPanel, FmPageHeader } from "@/components/fm";
import { QuickNoteForm } from "./quick-note-form";
import { HeaderAvatar } from "../header-avatar";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QuickNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClientById(id);
  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id;

  return (
    <FmAppShell
      activeNavId="clients"
      crumbs={[
        { label: "Clients", href: "/clients" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "Analyse", href: `/clients-v2/${id}/analyse` },
        { label: "Quick note" },
      ]}
    >
      {/* Compact client strip — same pattern as Analyse landing */}
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
        <HeaderAvatar clientId={id} displayName={displayName} />
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
              {id}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
            📌 Quick note — async log entry, single source on record
          </div>
        </div>
        <Link
          href={`/clients-v2/${id}/analyse`}
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

      <FmPageHeader
        as="h2"
        size="md"
        title="📌 Quick note"
        subtitle="Capture an observation between sessions — saves immediately. No plan generated."
      />

      <FmPanel style={{ maxWidth: 760 }}>
        <QuickNoteForm clientId={id} displayName={displayName} />
      </FmPanel>
    </FmAppShell>
  );
}
