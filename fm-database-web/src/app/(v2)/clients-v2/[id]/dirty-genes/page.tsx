/**
 * Coach-side "Dirty Genes" functional pathway-burden screen.
 *
 * Standalone per-client page (no sub-nav tab — it's an ad-hoc tool for
 * complex multi-system cases, reached from an Overview card). Loads the
 * questionnaire from the catalogue, any genetic-report SNPs on file (overlay
 * context), and the client's most recent saved screen; scoring runs live in
 * the client component.
 *
 * See src/lib/fmdb/dirty-genes.ts (pure scorer) +
 * fm-database/data/dirty_genes_assessment.yaml (questionnaire data).
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadClientById } from "@/lib/fmdb/loader-extras";
import { FmAppShell } from "@/components/fm";
import { HeaderAvatar } from "../analyse/header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import {
  loadDirtyGenesQuestionnaire,
  loadClientSnps,
  loadLatestDirtyGenesAssessment,
} from "@/lib/server-actions/dirty-genes";
import { DirtyGenesClient } from "./dirty-genes-client";

export const dynamic = "force-dynamic";

export default async function DirtyGenesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, qres, snpRes, latest] = await Promise.all([
    loadClientById(id),
    loadDirtyGenesQuestionnaire(),
    loadClientSnps(id),
    loadLatestDirtyGenesAssessment(id),
  ]);

  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id ?? id;

  return (
    <FmAppShell
      activeNavId="clients"
      quickActions={clientQuickActions(id)}
      crumbs={[
        { label: "Clients", href: "/clients-v2" },
        { label: displayName, href: `/clients-v2/${id}` },
        { label: "Dirty Genes screen" },
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
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            🧬 Dirty Genes — pathway-burden screen
          </div>
        </div>
        <Link
          href={`/clients-v2/${id}`}
          style={{ fontSize: 12, color: "var(--fm-text-secondary)", textDecoration: "none" }}
        >
          ← Overview
        </Link>
      </div>

      {qres.ok && qres.questionnaire ? (
        <DirtyGenesClient
          clientId={id}
          questionnaire={qres.questionnaire}
          snps={snpRes.snps}
          geneticSourceCount={snpRes.sourceCount}
          initialChecked={latest.checkedIds}
          initialNote={latest.note}
          previousScreenDate={latest.screenDate}
        />
      ) : (
        <div style={{ padding: 16, fontSize: 13, color: "var(--fm-text-tertiary)" }}>
          Questionnaire data not found ({qres.error ?? "unknown error"}).
        </div>
      )}
    </FmAppShell>
  );
}
