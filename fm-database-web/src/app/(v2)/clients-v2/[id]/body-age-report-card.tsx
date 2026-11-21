"use client";

/**
 * BodyAgeReportCard — build one person's body age report from the results on their record.
 *
 * "Build report" runs scripts/body-age-report.py and shows what came back: whether it is ready to send, what
 * blocks it, and links to the PDF and the email preview. "Send" emails that report (the approved email, the PDF
 * attached) and is the only way one leaves the app: the coach's click, confirmed, never automatic. Before the
 * launch only the test profile builds, and its email goes to the coach's own mailbox (body-age-send.ts).
 * `initial` is the last report built for this person, so a sent report still reads "Sent" after a reload.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";
import { outcomeLabel, type BodyAgeKind, type BodyAgeView } from "@/lib/fmdb/body-age-report-view";

const KINDS: { kind: BodyAgeKind; label: string }[] = [
  { kind: "standard", label: "Body age report" },
  { kind: "deeper", label: "With deeper tests" },
];

function sentLine(view: BodyAgeView): string {
  const d = new Date(view.sentAt ?? "");
  const when = Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `✓ Sent ${when} to ${view.sentTo}${view.sentTest ? " (test copy to you)" : ""}`;
}

export function BodyAgeReportCard({ clientId, initial = null }: { clientId: string; initial?: BodyAgeView | null }) {
  const [kind, setKind] = useState<BodyAgeKind>(initial?.kind ?? "standard");
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<BodyAgeView | null>(initial);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!view) return;
    const again = view.sentAt ? " again" : "";
    if (!window.confirm(`Send this report${again} by email now? The PDF goes with it.`)) return;
    setSending(true);
    setError("");
    try {
      const { sendBodyAgeReport } = await import("@/lib/server-actions/body-age-report");
      const out = await sendBodyAgeReport(clientId, view.reportNo);
      if (!out.ok) throw new Error(out.error);
      setView(out.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the email did not go");
    } finally {
      setSending(false);
    }
  };

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
    <FmPanel title="Body age report" subtitle="Builds the PDF and the email. Nothing is sent until you press Send.">
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
        <button type="button" className="fm-btn" onClick={build} disabled={busy || sending} style={{ marginLeft: "auto" }}>
          {busy ? "Building… about a minute" : view ? "Build again" : "Build report"}
        </button>
      </div>
      <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginTop: 8, color: "var(--fm-muted, #6f6a5d)" }}>
        <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} disabled={busy} />
        Save to their record. Tick this for the one you will send: it starts the 14-day session price and sets up their pay link.
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
            {view.ready && view.pdfUrl && (
              <button type="button" className="fm-btn" onClick={send} disabled={busy || sending}>
                {sending ? "Sending…" : view.sentAt ? "Send again" : "Send by email"}
              </button>
            )}
          </div>
          {view.sentAt && <p style={{ fontSize: 13, margin: 0, color: "#2f7a3f" }}>{sentLine(view)}</p>}
        </div>
      )}
    </FmPanel>
  );
}
