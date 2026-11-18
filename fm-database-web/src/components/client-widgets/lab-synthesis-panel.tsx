/**
 * Holistic lab read — system scores, patterns and cross-system rules built by
 * fm-database/fmdb/assess/lab_synthesis.py (deterministic, $0). Pure render:
 * used server-side on the client Overview and client-side on the Assess page.
 * Coach-only; nothing here reaches the client app.
 */
import type { LabSynthesis, LabSystemStatus } from "@/lib/fmdb/types";

const STATUS: Record<LabSystemStatus, { dot: string; bg: string; label: string }> = {
  red: { dot: "var(--fm-danger, #b42318)", bg: "rgba(180,35,24,0.07)", label: "Needs attention" },
  amber: { dot: "var(--fm-warning, #b54708)", bg: "rgba(181,71,8,0.07)", label: "Watch" },
  green: { dot: "var(--fm-success, #067647)", bg: "rgba(6,118,71,0.06)", label: "In range" },
  no_data: { dot: "#98a2b3", bg: "transparent", label: "Not measured" },
};

const LEVEL: Record<string, { color: string; tag: string }> = {
  red: { color: "var(--fm-danger, #b42318)", tag: "Act" },
  amber: { color: "var(--fm-warning, #b54708)", tag: "Watch" },
  info: { color: "#475467", tag: "Note" },
};

function fmtValue(v: number | string): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
  return String(v);
}

export function LabSynthesisPanel({
  synthesis,
  compact = false,
}: {
  synthesis: LabSynthesis | null | undefined;
  /** Assess-page preview: no empty systems, tighter spacing. */
  compact?: boolean;
}) {
  if (!synthesis || !Array.isArray(synthesis.systems)) return null;
  const systems = compact
    ? synthesis.systems.filter((s) => s.status !== "no_data")
    : synthesis.systems;
  const patterns = synthesis.patterns ?? [];
  const conf = synthesis.confounders;

  return (
    <section
      aria-label="Holistic lab read"
      style={{
        border: "1px solid var(--fm-border, #e4e7ec)",
        borderRadius: "var(--fm-radius-md, 10px)",
        background: "var(--fm-surface, #fff)",
        padding: compact ? 12 : 18,
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <div style={{ fontSize: 14, fontWeight: 700 }}>🧭 Holistic lab read</div>
        <div style={{ fontSize: 12, color: "var(--fm-text-secondary, #475467)" }}>
          System scores and root-cause patterns worked out from the markers ($0, no AI). A starting
          point for the coach, not a diagnosis.
        </div>
      </header>

      {conf && (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 6,
            background: conf.applied.length || !conf.recorded ? "rgba(181,71,8,0.08)" : "rgba(6,118,71,0.06)",
          }}
        >
          <strong>{conf.applied.length ? "⚠ Confounders: " : "Pre-test: "}</strong>
          {conf.note}
          {conf.applied.length > 0 && (
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {conf.applied.map((a) => (
                <li key={a.label}>
                  {a.label} — lower confidence on {a.affects.slice(0, 6).join(", ")}
                  {a.affects.length > 6 ? ` +${a.affects.length - 6} more` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 8,
        }}
      >
        {systems.map((s) => {
          const st = STATUS[s.status] ?? STATUS.no_data;
          return (
            <details
              key={s.key}
              style={{
                border: "1px solid var(--fm-border, #e4e7ec)",
                borderRadius: 8,
                background: st.bg,
                padding: "8px 10px",
                fontSize: 12,
              }}
            >
              <summary style={{ cursor: s.drivers.length ? "pointer" : "default", listStyle: "none" }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background: st.dot,
                    marginRight: 6,
                  }}
                />
                <strong>{s.label}</strong>
                <span style={{ color: "var(--fm-text-secondary, #475467)" }}>
                  {" "}· {st.label}
                  {s.low_confidence ? " (low confidence)" : ""}
                </span>
                <div style={{ color: "var(--fm-text-secondary, #475467)", marginTop: 2 }}>{s.summary}</div>
              </summary>
              {s.drivers.length > 0 && (
                <ul style={{ margin: "6px 0 0 14px", padding: 0 }}>
                  {s.drivers.map((d) => (
                    <li key={`${s.key}-${d.marker}`}>
                      {d.marker}: {fmtValue(d.value)} {d.unit} ({d.flag}
                      {d.low_confidence ? ", low confidence" : ""})
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </div>

      {patterns.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Patterns and cross-system links</div>
          {patterns.map((p) => {
            const lv = LEVEL[p.level] ?? LEVEL.info;
            return (
              <div
                key={p.key}
                style={{
                  borderLeft: `3px solid ${lv.color}`,
                  padding: "4px 10px",
                  fontSize: 12,
                }}
              >
                <div>
                  <span style={{ color: lv.color, fontWeight: 700 }}>{lv.tag}</span>{" "}
                  <strong>{p.label}</strong>
                  {p.kind === "cross_system" && (
                    <span style={{ color: "var(--fm-text-secondary, #475467)" }}> · cross-system</span>
                  )}
                </div>
                <div style={{ color: "var(--fm-text-secondary, #475467)" }}>{p.detail}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
