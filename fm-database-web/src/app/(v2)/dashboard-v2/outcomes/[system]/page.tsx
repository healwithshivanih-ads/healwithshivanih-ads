/**
 * /dashboard-v2/outcomes/[system] — per-system MSQ drill-down (MIS Phase 2).
 *
 * Click a system on the dashboard's "Symptom outcomes" panel → land here:
 *   - the individual MSQ items inside that system (which specific symptoms
 *     are worst / moving), and
 *   - the clients carrying the most burden in this system, each linking to
 *     their own page.
 * Pure read of the same msq_response data; nothing per-client lives on the
 * dashboard itself.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadAllClients } from "@/lib/fmdb/loader";
import { getSystemMsqDetail } from "@/lib/fmdb/msq-cohort";
import type { SystemMsqItem } from "@/lib/fmdb/msq-cohort";
import { FmAppShell, FmPageHeader, FmPanel } from "@/components/fm";

export const dynamic = "force-dynamic";

const C_IMPROVE = "var(--fm-success)";
const C_HOLD = "var(--fm-border-strong)";
const C_WORSE = "#e0544f";
const C_SEV = "#8d99ae";

function ItemRow({ it, trend }: { it: SystemMsqItem; trend: boolean }) {
  if (trend) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
        <div style={{ flex: "0 0 190px", fontSize: 12.5, color: "var(--fm-text-primary)" }}>{it.label}</div>
        <div style={{ flex: 1, height: 12, display: "flex", borderRadius: 999, overflow: "hidden", background: "var(--fm-bg-warm)" }}>
          {it.improving > 0 && <div style={{ flex: it.improving, background: C_IMPROVE }} />}
          {it.holding > 0 && <div style={{ flex: it.holding, background: C_HOLD }} />}
          {it.worse > 0 && <div style={{ flex: it.worse, background: C_WORSE }} />}
          {it.improving + it.holding + it.worse === 0 && <div style={{ flex: 1, background: "var(--fm-bg-warm)" }} />}
        </div>
        <div style={{ width: 40, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
          {it.avgLatest ?? it.avgBaseline}
        </div>
      </div>
    );
  }
  const w = Math.round((it.avgBaseline / 4) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
      <div style={{ flex: "0 0 190px", fontSize: 12.5, color: "var(--fm-text-primary)" }}>{it.label}</div>
      <div style={{ flex: 1, height: 12, borderRadius: 999, overflow: "hidden", background: "var(--fm-bg-warm)" }}>
        <div style={{ width: `${w}%`, height: "100%", background: C_SEV }} />
      </div>
      <div style={{ width: 40, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
        {it.avgBaseline}
      </div>
    </div>
  );
}

export default async function SystemOutcomePage({ params }: { params: Promise<{ system: string }> }) {
  const { system } = await params;
  const all = (await loadAllClients()) as Array<Record<string, unknown>>;
  const clients = all.map((c) => ({
    client_id: String(c.client_id),
    display_name: typeof c.display_name === "string" ? c.display_name : undefined,
  }));
  const detail = await getSystemMsqDetail(clients, system);
  if (!detail) notFound();

  const trend = detail.mode === "trend";

  return (
    <FmAppShell
      activeNavId="dashboard"
      crumbs={[{ label: "Dashboard", href: "/dashboard-v2" }, { label: detail.label }]}
    >
      <FmPageHeader
        title={`${detail.label} — symptom outcomes`}
        subtitle={
          detail.mode === "empty"
            ? "No MSQ data captured for this system yet."
            : trend
              ? `Cohort trajectory · ${detail.clientsWithTrend} with a retake`
              : `Cohort baseline · ${detail.clientsWithMsq} ${detail.clientsWithMsq === 1 ? "baseline" : "baselines"}`
        }
      />

      <div style={{ marginBottom: 18 }}>
        <Link href="/dashboard-v2" style={{ fontSize: 12.5, color: "var(--fm-text-secondary)", textDecoration: "none" }}>
          ‹ Back to dashboard
        </Link>
      </div>

      {detail.mode === "empty" ? (
        <FmPanel title={detail.label}>
          <p style={{ fontSize: 12.5, color: "var(--fm-text-secondary)", margin: 0 }}>
            No client has completed the MSQ yet, so there&apos;s nothing to break down for this system.
          </p>
        </FmPanel>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          <FmPanel>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "var(--fm-text-primary)" }}>
                {trend ? detail.avgLatest : detail.avgBaseline}
              </span>
              <span style={{ fontSize: 13, color: "var(--fm-text-tertiary)" }}>
                avg {detail.label.toLowerCase()} score · out of {detail.maxScore} · lower is better
              </span>
              {trend && detail.deltaPct !== null && detail.deltaPct !== 0 && (
                <span style={{ fontSize: 13, fontWeight: 700, color: detail.deltaPct < 0 ? C_IMPROVE : C_WORSE }}>
                  {detail.deltaPct < 0 ? "↓" : "↑"} {Math.abs(detail.deltaPct)}% since baseline
                </span>
              )}
            </div>
          </FmPanel>

          <FmPanel
            title="Symptoms in this system"
            subtitle={trend ? "Sorted by movement across clients" : "Sorted by how common they are at baseline"}
          >
            {detail.items.map((it) => (
              <ItemRow key={it.index} it={it} trend={trend} />
            ))}
          </FmPanel>

          <FmPanel title="Clients carrying this" subtitle="Most burden first · tap to open their page">
            {detail.clients.map((c) => (
              <Link
                key={c.clientId}
                href={`/clients-v2/${c.clientId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px dashed var(--fm-border-light)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--fm-text-primary)" }}>{c.displayName}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {trend && c.deltaPct !== null && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: c.deltaPct < 0 ? C_IMPROVE : c.deltaPct > 0 ? C_WORSE : "var(--fm-text-tertiary)",
                      }}
                    >
                      {c.deltaPct < 0 ? "↓" : c.deltaPct > 0 ? "↑" : "→"} {Math.abs(c.deltaPct)}%
                    </span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
                    {trend && c.latest !== null ? c.latest : c.baseline}
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", fontWeight: 400 }}> / {detail.maxScore}</span>
                  </span>
                  <span style={{ color: "var(--fm-text-tertiary)", fontSize: 14 }}>›</span>
                </span>
              </Link>
            ))}
          </FmPanel>
        </div>
      )}
    </FmAppShell>
  );
}
