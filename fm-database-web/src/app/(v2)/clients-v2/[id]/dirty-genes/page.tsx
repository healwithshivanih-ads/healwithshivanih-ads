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
import { loadAllPlans } from "@/lib/fmdb/loader";
import { FmAppShell } from "@/components/fm";
import { HeaderAvatar } from "../analyse/header-avatar";
import { clientQuickActions } from "../client-quick-actions";
import {
  loadDirtyGenesQuestionnaire,
  loadClientSnps,
  loadLatestDirtyGenesAssessment,
} from "@/lib/server-actions/dirty-genes";
import { computePrefill } from "@/lib/fmdb/dirty-genes-prefill";
import { DirtyGenesClient } from "./dirty-genes-client";

/** Build a lowercased marker→latest-value map from health_snapshots. */
function extractLabValues(client: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const snaps = (client.health_snapshots as Array<Record<string, unknown>>) ?? [];
  for (const snap of snaps) {
    for (const lv of (snap.lab_values as Array<Record<string, unknown>>) ?? []) {
      const name = String(lv.test_name ?? "").trim().toLowerCase();
      const num = typeof lv.value === "number" ? lv.value : parseFloat(String(lv.value ?? ""));
      if (name && !Number.isNaN(num)) out[name] = num; // later snapshot wins
    }
  }
  return out;
}

function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" · ");
  return "";
}

export const dynamic = "force-dynamic";

export default async function DirtyGenesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, qres, snpRes, latest, allPlans] = await Promise.all([
    loadClientById(id),
    loadDirtyGenesQuestionnaire(),
    loadClientSnps(id),
    loadLatestDirtyGenesAssessment(id),
    loadAllPlans(),
  ]);

  if (!client) notFound();

  const displayName = client.display_name ?? client.client_id ?? id;

  // Target for "add to plan" = the client's most-recent DRAFT plan (only drafts
  // are writable). null → the panel shows "create a draft first".
  const draftPlan = allPlans
    .filter((p) => p.client_id === id && ((p.status as string) ?? "draft") === "draft")
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
  const draftPlanSlug = (draftPlan?.slug as string | undefined) ?? null;

  // P2 auto-prefill: pre-flag pathways from the client's own record.
  const prefill = computePrefill({
    labValues: extractLabValues(client),
    conditionsText: [
      toText(client.active_conditions),
      toText(client.reported_triggers),
      toText(client.foods_to_avoid),
      toText(client.medical_history),
    ]
      .join(" · ")
      .toLowerCase(),
    dietaryPreference: String(client.dietary_preference ?? "").toLowerCase(),
  });

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
          draftPlanSlug={draftPlanSlug}
          prefillChecked={prefill.autoChecked}
          labFlags={prefill.labFlags}
          prefillProvenance={prefill.provenance}
        />
      ) : (
        <div style={{ padding: 16, fontSize: 13, color: "var(--fm-text-tertiary)" }}>
          Questionnaire data not found ({qres.error ?? "unknown error"}).
        </div>
      )}
    </FmAppShell>
  );
}
