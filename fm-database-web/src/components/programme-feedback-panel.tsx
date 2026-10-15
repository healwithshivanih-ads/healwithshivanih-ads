/**
 * 💬 How are we doing — the client's own verdict on the programme, next to
 * the clients who finished and haven't been asked yet.
 *
 * Read-only server component: the data comes from loadProgrammeFeedback()
 * (lib/fmdb/programme-feedback-loader.ts); the only action is the coach
 * tapping a WhatsApp link she sends herself. Self-hides when there is neither
 * a response nor anyone to ask.
 */
import Link from "next/link";
import { FmPanel } from "@/components/fm";
import { FEEDBACK_PARTS, GOAL_CHANGE } from "@/lib/fmdb/programme-feedback";
import type { ProgrammeFeedbackData } from "@/lib/fmdb/programme-feedback-loader";

const STAGE_LABEL = { midpoint: "Halfway", graduation: "End of programme", followup: "3 months on" } as const;

function fmtDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const statBox: React.CSSProperties = {
  flex: "1 1 120px",
  padding: "8px 10px",
  background: "var(--fm-surface)",
  border: "1px solid var(--fm-border-light)",
  borderRadius: "var(--fm-radius-sm)",
};
const statNum: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "var(--fm-text-primary)" };
const statLabel: React.CSSProperties = { fontSize: 11, color: "var(--fm-text-secondary)", fontWeight: 600 };
const rowBox: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--fm-surface)",
  border: "1px solid var(--fm-border-light)",
  borderRadius: "var(--fm-radius-sm)",
};
const sectionHead: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--fm-text-secondary)",
  margin: "14px 0 6px",
};

export function ProgrammeFeedbackPanel({ data }: { data: ProgrammeFeedbackData }) {
  const { rows, summary, asks } = data;
  if (rows.length === 0 && asks.length === 0) return null;

  const gc = summary.goalChange;
  const betterPct = gc.rated ? Math.round(((gc.better + gc.resolved) / gc.rated) * 100) : null;
  const quotes = rows.filter((r) => r.testimonial !== "no" && r.biggest_change);
  const recent = rows.slice(0, 6);

  return (
    <FmPanel
      title="💬 How are we doing"
      subtitle={
        rows.length
          ? `${summary.responses} feedback response${summary.responses === 1 ? "" : "s"} from ${summary.clients} client${summary.clients === 1 ? "" : "s"}, in their own words`
          : "No feedback yet. Ask the clients below who have finished."
      }
    >
      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={statBox} title="% who'd score 9–10 minus % who'd score 0–6. End-of-programme and follow-up answers only.">
              <div style={statNum}>{summary.nps === null ? "—" : summary.nps}</div>
              <div style={statLabel}>Would recommend (NPS, n={summary.npsAnswered})</div>
            </div>
            <div style={statBox} title={`${gc.resolved} resolved · ${gc.better} better · ${gc.same} no change · ${gc.worse} worse`}>
              <div style={statNum}>{betterPct === null ? "—" : `${betterPct}%`}</div>
              <div style={statLabel}>Of their goals got better or resolved (n={gc.rated})</div>
            </div>
          </div>

          {Object.keys(summary.parts).length > 0 && (
            <>
              <div style={sectionHead}>Parts of the programme (1–5)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FEEDBACK_PARTS.filter((p) => summary.parts[p.id]).map((p) => (
                  <span key={p.id} style={{ ...rowBox, padding: "4px 10px", fontSize: 12 }}>
                    {p.label} <strong>{summary.parts[p.id].avg}</strong>
                    <span style={{ color: "var(--fm-text-secondary)" }}> · n={summary.parts[p.id].n}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {quotes.length > 0 && (
            <>
              <div style={sectionHead}>May be quoted</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {quotes.map((r) => (
                  <div key={`${r.clientId}-${r.date}-${r.stage}`} style={rowBox}>
                    <div style={{ fontSize: 13, fontStyle: "italic" }}>“{r.biggest_change}”</div>
                    <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 3 }}>
                      {r.testimonial === "named" ? `— ${r.clientName.split(" ")[0]}` : "— anonymous"} ·{" "}
                      <Link href={`/clients-v2/${r.clientId}`}>{r.clientName}</Link> · {fmtDate(r.date)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={sectionHead}>Latest</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map((r) => (
              <details key={`${r.clientId}-${r.date}-${r.stage}`} style={rowBox}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>
                  <strong>{r.clientName}</strong>
                  <span style={{ color: "var(--fm-text-secondary)" }}>
                    {" "}
                    · {STAGE_LABEL[r.stage]} · {fmtDate(r.date)}
                    {r.recommend !== null ? ` · recommend ${r.recommend}/10` : ""}
                  </span>
                </summary>
                <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.goals
                    .filter((g) => g.change !== null)
                    .map((g, i) => (
                      <div key={i}>
                        🎯 {g.goal}: <strong>{GOAL_CHANGE.find((o) => o.v === g.change)?.label}</strong>
                      </div>
                    ))}
                  {r.biggest_change && <div>✨ <strong>Changed most:</strong> {r.biggest_change}</div>}
                  {r.hardest && <div>⛰ <strong>Hardest:</strong> {r.hardest}</div>}
                  {r.change_one_thing && <div>🔧 <strong>Would change:</strong> {r.change_one_thing}</div>}
                  <div>
                    <Link href={`/clients-v2/${r.clientId}`}>Open client →</Link>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      {asks.length > 0 && (
        <>
          <div style={sectionHead}>Finished, not asked yet</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {asks.map((a) => (
              <div
                key={a.client_id}
                style={{ ...rowBox, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
              >
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <Link href={`/clients-v2/${a.client_id}`} style={{ fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}>
                    {a.display_name}
                  </Link>
                  <span style={{ fontSize: 11, color: "var(--fm-text-secondary)", fontWeight: 600 }}> · finished {fmtDate(a.ended_on)}</span>
                </div>
                {a.whatsapp ? (
                  <a
                    href={a.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flexShrink: 0,
                      border: "1px solid rgba(37, 211, 102, 0.5)",
                      color: "#128c4b",
                      borderRadius: "var(--fm-radius-pill)",
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    💬 Ask on WhatsApp
                  </a>
                ) : (
                  <code style={{ fontSize: 11, wordBreak: "break-all" }}>{a.link}</code>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </FmPanel>
  );
}
