/**
 * PracticeOverviewPanel — the MIS overview block (Phase 3): client status
 * band, practice composition, and pipeline. Server component. Renders from the
 * pure model in lib/fmdb/practice-overview.ts. No per-client cards — clients
 * appear only as navigational chips where they're the exception worth opening.
 */
import Link from "next/link";
import { FmPanel } from "@/components/fm";
import type { PracticeOverview, StatusEntry } from "@/lib/fmdb/practice-overview";

const C_GREEN = "var(--fm-success)";
const C_AMBER = "var(--fm-primary)";
const C_RED = "#e0544f";
const C_NEUTRAL = "var(--fm-border-strong)";
const C_SEV = "#8d99ae";

function Dot({ color }: { color: string }) {
  return <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />;
}

function ExceptionChips({ entries, color }: { entries: StatusEntry[]; color: string }) {
  return (
    <>
      {entries.map((e) => (
        <Link
          key={e.clientId}
          href={`/clients-v2/${e.clientId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "3px 9px",
            border: "0.5px solid var(--fm-border)",
            borderRadius: 999,
            textDecoration: "none",
            color: "var(--fm-text-primary)",
          }}
        >
          <Dot color={color} />
          {e.name}
          <span style={{ color: "var(--fm-text-tertiary)" }}>· {e.why}</span>
        </Link>
      ))}
    </>
  );
}

function CompList({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>No data yet</p>
      ) : (
        items.map((c) => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
            <div style={{ flex: "0 0 130px", fontSize: 12.5, color: "var(--fm-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.label}>
              {c.label}
            </div>
            <div style={{ flex: 1, height: 10, borderRadius: 999, overflow: "hidden", background: "var(--fm-bg-warm)" }}>
              <div style={{ width: `${Math.round((c.count / max) * 100)}%`, height: "100%", background: C_SEV }} />
            </div>
            <div style={{ width: 22, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>{c.count}</div>
          </div>
        ))
      )}
    </div>
  );
}

export function PracticeOverviewPanel({
  data,
  symptoms = [],
  drivers = [],
}: {
  data: PracticeOverview;
  symptoms?: { label: string; count: number }[];
  drivers?: { label: string; count: number }[];
}) {
  const { activeCare, onTrack, watch, stalled, onTrackPct } = data;
  const pipeMax = Math.max(data.pipeline.prospect, data.pipeline.onboarding, data.pipeline.active, data.pipeline.maintenance, 1);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Client status band */}
      <FmPanel
        title="Client status — who's on track"
        subtitle="Active-care clients · composed from engagement, body trend & plan cadence"
        rightSlot={
          onTrackPct !== null ? (
            <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
              <span style={{ fontWeight: 700, color: "var(--fm-text-primary)" }}>{onTrackPct}%</span> on track
            </span>
          ) : undefined
        }
      >
        {activeCare === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--fm-text-secondary)", margin: 0 }}>
            No clients in active care yet — the band fills in once plans are published.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
              {onTrack > 0 && <div style={{ flex: onTrack, height: 14, background: C_GREEN, borderRadius: 4 }} />}
              {watch > 0 && <div style={{ flex: watch, height: 14, background: C_AMBER, borderRadius: 4 }} />}
              {stalled > 0 && <div style={{ flex: stalled, height: 14, background: C_RED, borderRadius: 4 }} />}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: watch + stalled > 0 ? 12 : 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fm-text-secondary)" }}>
                <Dot color={C_GREEN} /> On track {onTrack}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fm-text-secondary)" }}>
                <Dot color={C_AMBER} /> Watch {watch}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fm-text-secondary)" }}>
                <Dot color={C_RED} /> Stalled {stalled}
              </span>
            </div>
            {watch + stalled > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                <ExceptionChips entries={data.stalledList} color={C_RED} />
                <ExceptionChips entries={data.watchList} color={C_AMBER} />
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--fm-text-tertiary)", lineHeight: 1.5 }}>
              Adherence (weekly polls) and MSQ trajectory join this rule as that data accrues — today it reflects contact
              recency, weight trend and plan cadence.
            </div>
          </>
        )}
      </FmPanel>

      {/* minmax(280px, …) so auto-fit actually drops Pipeline below Composition
          on phones/split-screen instead of forcing two ~169px columns. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {/* Composition — conditions + symptoms + root causes */}
        <FmPanel title="Practice composition" subtitle="What recurs across your clients">
          <div style={{ display: "grid", gap: 16 }}>
            <CompList title="Top conditions" items={data.composition} />
            <CompList title="Top symptoms" items={symptoms} />
            <CompList title="Top root causes" items={drivers} />
          </div>
        </FmPanel>

        {/* Pipeline */}
        <FmPanel title="Pipeline" subtitle="Where clients are in the journey">
          <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
            {([
              { label: "Prospect", n: data.pipeline.prospect },
              { label: "Onboarding", n: data.pipeline.onboarding },
              { label: "Active", n: data.pipeline.active },
              { label: "Maintenance", n: data.pipeline.maintenance },
            ] as const).map((stage, i, arr) => (
              <div key={stage.label} style={{ display: "contents" }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "var(--fm-bg-warm)",
                    borderRadius: "var(--fm-radius-md)",
                    padding: "10px 8px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--fm-text-primary)" }}>{stage.n}</div>
                  <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 2 }}>{stage.label}</div>
                  <div style={{ marginTop: 6, height: 4, borderRadius: 999, background: "var(--fm-border-light)" }}>
                    <div style={{ width: `${Math.round((stage.n / pipeMax) * 100)}%`, height: "100%", borderRadius: 999, background: C_SEV }} />
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ alignSelf: "center", color: "var(--fm-text-tertiary)", fontSize: 14 }}>›</div>
                )}
              </div>
            ))}
          </div>
        </FmPanel>
      </div>
    </div>
  );
}
