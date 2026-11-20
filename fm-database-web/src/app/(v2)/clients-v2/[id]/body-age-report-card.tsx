"use client";

/**
 * BodyAgeReportCard — build one person's body age report from the results on their record.
 *
 * One click runs scripts/body-age-report.py and shows what came back: whether it is ready to send, what blocks
 * it, and links to the PDF and the email preview. The files are DRAFTS. Nothing is emailed from here; the coach
 * downloads the PDF and sends it herself. Before the launch the script builds the test profile only and says so.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";
import { outcomeLabel, type BodyAgeKind, type BodyAgeView } from "@/lib/fmdb/body-age-report-view";

const KINDS: { kind: BodyAgeKind; label: string }[] = [
  { kind: "standard", label: "Body age report" },
  { kind: "deeper", label: "With deeper tests" },
];

export function BodyAgeReportCard({ clientId }: { clientId: string }) {
  const [kind, setKind] = useState<BodyAgeKind>("standard");
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<BodyAgeView | null>(null);

  const build = async () => {
    setBusy(true);
    setError("");
    setView(null);
    try {
      const { buildBodyAgeReport } = await import("@/lib/server-actions/body-age-report");
      const out = await buildBodyAgeReport(clientId, kind, record);
      if (!out.ok) throw new Error(out.error);
      setView(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the report could not be built");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FmPanel title="Body age report" subtitle="Builds the PDF and the email as drafts. Nothing is sent from here.">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {KINDS.map((k) => (
          <label key={k.kind} style={{ fontSize: 13, display: "inline-flex", gap: 5, alignItems: "center" }}>
            <input
              type="radio"
              name={`body-age-kind-${clientId}`}
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
              disabled={busy}
            />
            {k.label}
          </label>
        ))}
        <button type="button" className="fm-btn" onClick={build} disabled={busy} style={{ marginLeft: "auto" }}>
          {busy ? "Building… about a minute" : view ? "Build again" : "Build report"}
        </button>
      </div>
      <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginTop: 8, color: "var(--fm-muted, #6f6a5d)" }}>
        <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} disabled={busy} />
        Save to their record. Tick this for the one you will send: it starts the 14-day session credit.
      </label>

      {error && (
        <p role="alert" style={{ fontSize: 13, color: "#9a3412", marginTop: 10 }}>
          {error}
        </p>
      )}

      {view && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: view.ready ? "#2f7a3f" : "#9a3412" }}>
            {view.ready ? "Ready to send" : "Not ready: do not send yet"}
            <span style={{ fontWeight: 400, color: "var(--fm-muted, #6f6a5d)" }}>
              {" · "}
              {outcomeLabel(view.outcome)}
              {view.pages ? ` · ${view.pages} pages` : ""}
              {view.recorded ? " · saved to their record" : ""}
            </span>
          </p>
          {view.blockers.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#9a3412" }}>
              {view.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {view.warnings.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--fm-muted, #6f6a5d)" }}>
              {view.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {view.pdfUrl && (
              <a href={view.pdfUrl} target="_blank" rel="noreferrer" className="fm-btn">
                Open the PDF
              </a>
            )}
            {view.emailUrl && (
              <a href={view.emailUrl} target="_blank" rel="noreferrer" className="fm-btn">
                Open the email preview
              </a>
            )}
          </div>
        </div>
      )}
    </FmPanel>
  );
}
