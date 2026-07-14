/**
 * Dirty Genes Overview card — proactive, coach-side, self-hiding.
 *
 * Appears on the client Overview ONLY when the client's own record trips the
 * gene-pathway screen (a lab crosses a threshold, or a condition/diet matches),
 * OR a screen was already run. For everyone else it renders nothing — so it
 * surfaces exactly the complex multi-system clients where it matters, staying
 * true to "ad-hoc for complex cases, not a default feature".
 *
 * Pure presentation over the prefill result (computed in page.tsx). No gene
 * language ever leaves the coach surfaces.
 */
import Link from "next/link";
import { prefillFlaggedPathways, type PrefillResult } from "@/lib/fmdb/dirty-genes-prefill";

const SOURCE_LABEL: Record<string, string> = { lab: "labs", condition: "history", diet: "diet" };

export function DirtyGenesOverviewCard({
  clientId,
  prefill,
  lastScreenDate,
}: {
  clientId: string;
  prefill: PrefillResult;
  lastScreenDate?: string | null;
}) {
  const flagged = prefillFlaggedPathways(prefill);
  // self-hide: nothing in the record fires AND no prior screen
  if (flagged.length === 0 && !lastScreenDate) return null;

  return (
    <div
      style={{
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        background: "var(--fm-surface)",
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>🧬 Gene-pathway screen</div>
        <Link
          href={`/clients-v2/${clientId}/dirty-genes`}
          style={{ fontSize: 12, color: "var(--fm-accent, #2f5233)", textDecoration: "none", fontWeight: 600 }}
        >
          {lastScreenDate ? "Open →" : "Run screen →"}
        </Link>
      </div>

      {flagged.length > 0 ? (
        <>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginBottom: 6, lineHeight: 1.5 }}>
            This client&apos;s record flags {flagged.length} pathway{flagged.length > 1 ? "s" : ""} worth a look
            {lastScreenDate ? "" : " — screen not run yet"}:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {flagged.map((f) => (
              <span
                key={f.pathwayId}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: f.source === "lab" ? "rgba(37,99,235,0.10)" : "var(--fm-surface-subtle, #f4f4f2)",
                  color: f.source === "lab" ? "#1d4ed8" : "var(--fm-text-secondary)",
                  border: "1px solid " + (f.source === "lab" ? "rgba(37,99,235,0.3)" : "var(--fm-border-light)"),
                }}
              >
                {f.label} · {SOURCE_LABEL[f.source] ?? f.source}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>
          Nothing auto-flags right now.
        </div>
      )}

      {lastScreenDate && (
        <div style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)", marginTop: 6 }}>
          Last screened {lastScreenDate}
        </div>
      )}
    </div>
  );
}
