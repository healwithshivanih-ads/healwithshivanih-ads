/**
 * FmIntakeActivityBanner — dashboard heads-up for fresh intake activity.
 *
 * Sister to FmInboundMessagesBanner. Surfaces clients who have moved
 * forward in the intake flow (opened the link / started filling /
 * submitted) since the last time coach looked — so coach doesn't have
 * to manually check each client's Overview to find out who's making
 * progress.
 *
 * Three buckets, ordered most-actionable first:
 *   📥 Submitted   — last 7d. Coach should review the answers + finalise.
 *   ✍  Started    — last 24h. Light awareness; check in if it's been
 *                    days since they last edited.
 *   👀 Opened     — last 24h. They've at least seen the link.
 *
 * Click a chip → open that client's Overview (the IntakeProgressCard
 * there has the full ledger).
 */
import Link from "next/link";
import { FmPanel } from "./FmPanel";
import type { IntakeActivityEntry } from "@/lib/fmdb/loader-extras";

export interface FmIntakeActivityBannerProps {
  entries: IntakeActivityEntry[];
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffMin = Math.round((Date.now() - t) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

const KIND_META: Record<
  IntakeActivityEntry["kind"],
  { emoji: string; label: string; tint: string; border: string; fg: string }
> = {
  submitted: {
    emoji: "📥",
    label: "Submitted",
    tint: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.4)",
    fg: "#065f46",
  },
  started: {
    emoji: "✍",
    label: "Started filling",
    tint: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.4)",
    fg: "#92400e",
  },
  opened: {
    emoji: "👀",
    label: "Opened",
    tint: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.4)",
    fg: "#1e3a8a",
  },
};

export function FmIntakeActivityBanner({ entries }: FmIntakeActivityBannerProps) {
  if (entries.length === 0) return null;

  // Group by kind so chips share visual context (all the green
  // "submitted" rows together, etc.).
  const buckets: Record<IntakeActivityEntry["kind"], IntakeActivityEntry[]> = {
    submitted: [],
    started: [],
    opened: [],
  };
  for (const e of entries) buckets[e.kind].push(e);

  const submittedCount = buckets.submitted.length;
  const startedCount = buckets.started.length;
  const openedCount = buckets.opened.length;

  // Headline emphasises the action-worthy bucket. Submissions need a
  // review; starts and opens are FYI.
  const headlineParts: string[] = [];
  if (submittedCount > 0)
    headlineParts.push(
      `${submittedCount} just submitted`,
    );
  if (startedCount > 0)
    headlineParts.push(`${startedCount} filling now`);
  if (openedCount > 0) headlineParts.push(`${openedCount} just opened`);
  const headline = headlineParts.join(" · ");

  return (
    <FmPanel
      style={{
        padding: "12px 16px",
        background:
          "linear-gradient(135deg, rgba(245,158,11,0.08), rgba(16,185,129,0.05))",
        borderColor: "rgba(245, 158, 11, 0.30)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>📝</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            Intake form activity
            <span
              style={{
                fontSize: 10,
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                color: "#7c2d12",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              fresh
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {headline}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {(["submitted", "started", "opened"] as const).map((kind) => {
          const rows = buckets[kind];
          if (rows.length === 0) return null;
          const meta = KIND_META[kind];
          return (
            <div key={kind} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: meta.fg,
                  minWidth: 92,
                }}
              >
                {meta.emoji} {meta.label}
              </span>
              {rows.map((r) => (
                <Link
                  key={r.client_id}
                  href={`/clients-v2/${r.client_id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    background: meta.tint,
                    border: `1px solid ${meta.border}`,
                    borderRadius: "var(--fm-radius-pill)",
                    fontSize: 11,
                    textDecoration: "none",
                    color: "var(--fm-text-primary)",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {r.display_name ?? r.client_id}
                  </span>
                  {kind === "started" && typeof r.fields_filled === "number" && (
                    <span style={{ color: "var(--fm-text-tertiary)", fontSize: 10 }}>
                      · {r.fields_filled} field{r.fields_filled === 1 ? "" : "s"}
                    </span>
                  )}
                  <span style={{ color: "var(--fm-text-tertiary)", fontSize: 10 }}>
                    · {relativeTime(r.at)}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </FmPanel>
  );
}
