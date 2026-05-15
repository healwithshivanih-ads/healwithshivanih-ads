"use client";

/**
 * WeeklyPollPanel — dashboard-side widget for the weekly WhatsApp check-in.
 *
 * Two collapsibles in one panel:
 *
 *   1. "📣 Send weekly check-in poll"
 *      Coach clicks → calls sendWeeklyPollAction([]) which auto-selects
 *      all clients with a published plan + mobile number on file. Shows
 *      sent / skipped / failed breakdown. Audit log written to
 *      ~/fm-plans/_weekly_poll_log.yaml by the action.
 *
 *   2. "🚨 Adherence drops (last 28 days)"
 *      Calls detectAdherenceDropsAction() and lists any client whose poll
 *      replies tripped the 3-strike rule (2+ "struggling" OR 3+ "partial").
 *      Each flagged client has a "🔁 Run rework" button that fires
 *      runReworkSuggestionAction(clientId) — same code path the rework
 *      banner on the client page uses.
 *
 * Both panels short-circuit when WHATSAPP_SERVER_URL isn't set — caller
 * passes `whatsappConfigured`. We don't import the env var directly because
 * this component is "use client" and process.env doesn't carry to the
 * browser.
 */

import { useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";

interface SendResult {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
  sent_to: string[];
}

interface AdherenceFlag {
  client_id: string;
  display_name?: string;
  strikes: number;
  dimensions_flagged: string[];
  last_response_at?: string;
}

interface Props {
  whatsappConfigured: boolean;
}

export function WeeklyPollPanel({ whatsappConfigured }: Props) {
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [scanLoading, setScanLoading] = useState(false);
  const [flags, setFlags] = useState<AdherenceFlag[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [reworkingId, setReworkingId] = useState<string | null>(null);
  const [reworkErrors, setReworkErrors] = useState<Record<string, string>>({});
  const [reworkDone, setReworkDone] = useState<Record<string, boolean>>({});

  async function handleSend() {
    if (!confirm("Send the weekly check-in poll to every client with a published plan?")) return;
    setSendLoading(true);
    setSendError(null);
    setSendResult(null);
    try {
      const { sendWeeklyPollAction } = await import(
        "@/lib/server-actions/weekly-poll"
      );
      const r = await sendWeeklyPollAction();
      setSendResult(r);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSendLoading(false);
    }
  }

  async function handleScan() {
    setScanLoading(true);
    setScanError(null);
    setFlags(null);
    try {
      const { detectAdherenceDropsAction } = await import(
        "@/lib/server-actions/weekly-poll"
      );
      const r = await detectAdherenceDropsAction(28);
      if (!r.ok) {
        setScanError(r.error);
      } else {
        setFlags(r.flags);
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Failed");
    } finally {
      setScanLoading(false);
    }
  }

  async function handleRework(clientId: string) {
    setReworkingId(clientId);
    setReworkErrors((p) => ({ ...p, [clientId]: "" }));
    try {
      const { assessReworkBenefitAction } = await import(
        "@/lib/server-actions/clients"
      );
      const r = await assessReworkBenefitAction({
        clientId,
        // 'quick_note' is the closest existing trigger enum — poll responses
        // are stored as quick_note sessions tagged [source: weekly_check_in_poll].
        triggeredBy: "quick_note",
        eventSummary:
          "Weekly check-in poll: 3-strike adherence drop detected. Review whether the protocol is too demanding or the wrong fit and propose simplification or substitution.",
      });
      if (!r.ok) {
        setReworkErrors((p) => ({ ...p, [clientId]: r.error || "Rework failed" }));
      } else {
        setReworkDone((p) => ({ ...p, [clientId]: true }));
      }
    } catch (e) {
      setReworkErrors((p) => ({
        ...p,
        [clientId]: e instanceof Error ? e.message : "Failed",
      }));
    } finally {
      setReworkingId(null);
    }
  }

  return (
    <FmPanel
      title="📣 Weekly check-in poll"
      subtitle="WhatsApp pulse — adherence on supplements, meals, movement"
    >
      <div style={{ display: "grid", gap: 14 }}>
        {!whatsappConfigured && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(234, 88, 12, 0.08)",
              border: "1px solid rgba(234, 88, 12, 0.25)",
              fontSize: 12,
            }}
          >
            <strong>WhatsApp outbound not configured.</strong> Add{" "}
            <code>WHATSAPP_SERVER_URL</code> + <code>WHATSAPP_SERVER_API_KEY</code> to{" "}
            <code>.env.local</code> (points at <code>whatsapp-server-shivani.fly.dev</code>),
            and register the <code>fm_weekly_check_in_v1</code> template in your WABA with
            interactive reply buttons: <em>All good 🌿</em> / <em>Some struggles</em> /
            <em>Need help</em>.
          </div>
        )}

        {/* ── Send poll ── */}
        <div style={{ display: "grid", gap: 8 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={!whatsappConfigured || sendLoading}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: whatsappConfigured ? "#059669" : "rgba(0,0,0,0.1)",
              color: "white",
              border: "none",
              cursor: sendLoading ? "wait" : whatsappConfigured ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: 13,
              width: "fit-content",
            }}
          >
            {sendLoading ? "Sending…" : "📣 Send poll to all active clients"}
          </button>
          {sendResult && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <FmChip tone="success">{sendResult.sent} sent</FmChip>
              {sendResult.skipped > 0 && (
                <FmChip tone="neutral">{sendResult.skipped} skipped</FmChip>
              )}
              {sendResult.failed > 0 && (
                <FmChip tone="danger">{sendResult.failed} failed</FmChip>
              )}
              {sendResult.errors.length > 0 && (
                <details style={{ fontSize: 11, marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.7 }}>
                    Errors ({sendResult.errors.length})
                  </summary>
                  <ul style={{ marginTop: 4 }}>
                    {sendResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {sendError && (
            <div style={{ color: "#dc2626", fontSize: 12 }}>{sendError}</div>
          )}
        </div>

        {/* ── Adherence-drop scan ── */}
        <div style={{ display: "grid", gap: 8, borderTop: "1px dashed rgba(0,0,0,0.1)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanLoading}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "white",
                border: "1px solid rgba(0,0,0,0.15)",
                cursor: scanLoading ? "wait" : "pointer",
                fontSize: 13,
              }}
            >
              {scanLoading ? "Scanning…" : "🚨 Scan for adherence drops (last 28d)"}
            </button>
            {flags !== null && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {flags.length} flagged
              </span>
            )}
          </div>

          {scanError && (
            <div style={{ color: "#dc2626", fontSize: 12 }}>{scanError}</div>
          )}

          {flags && flags.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              No clients tripped the 3-strike rule. Adherence looks healthy.
            </div>
          )}

          {flags && flags.length > 0 && (
            <ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {flags.map((f) => (
                <li
                  key={f.client_id}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.04)",
                    display: "grid",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {f.display_name || f.client_id}{" "}
                      <span style={{ opacity: 0.6, fontWeight: 400 }}>
                        — {f.strikes} strike{f.strikes !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <a
                        href={`/clients-v2/${f.client_id}`}
                        style={{ fontSize: 12, color: "#0369a1" }}
                      >
                        Open client →
                      </a>
                      {!reworkDone[f.client_id] && (
                        <button
                          type="button"
                          onClick={() => handleRework(f.client_id)}
                          disabled={reworkingId === f.client_id}
                          style={{
                            fontSize: 12,
                            padding: "4px 8px",
                            borderRadius: 4,
                            background: "#7c3aed",
                            color: "white",
                            border: "none",
                            cursor: reworkingId === f.client_id ? "wait" : "pointer",
                          }}
                        >
                          {reworkingId === f.client_id ? "…" : "🔁 Run rework"}
                        </button>
                      )}
                      {reworkDone[f.client_id] && (
                        <FmChip tone="success">✓ Rework run</FmChip>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Dimensions: {f.dimensions_flagged.join(", ") || "(none)"}
                    {f.last_response_at && ` · last reply ${f.last_response_at}`}
                  </div>
                  {reworkErrors[f.client_id] && (
                    <div style={{ color: "#dc2626", fontSize: 11 }}>
                      {reworkErrors[f.client_id]}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </FmPanel>
  );
}
