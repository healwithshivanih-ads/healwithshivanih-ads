"use client";

/**
 * CycleDateReminderPanel — dashboard "actions due" widget listing every
 * menstruating / perimenopausal client whose next period is due or overdue
 * and who hasn't been asked for the date this cycle.
 *
 * Each row has a "📲 Send check" button that fires the fm_cycle_date_check_v1
 * WhatsApp template. The client's dated reply is picked up by the webhook
 * (recordInboundCycleDate) and auto-updates last_menstrual_period — so once
 * she replies, the row clears itself on the next load.
 *
 * Hidden when there's nothing due, or when WhatsApp outbound isn't set up.
 */

import { useEffect, useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Flag {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  last_menstrual_period: string;
  cycle_length_days: number;
  next_expected: string;
  days_overdue: number;
  last_cycle_ask_sent: string | null;
}

interface Props {
  whatsappConfigured: boolean;
}

function formatHuman(ymd: string | null): string {
  if (!ymd) return "—";
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return ymd;
  }
}

export function CycleDateReminderPanel({ whatsappConfigured }: Props) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});

  async function loadFlags() {
    setLoading(true);
    setError(null);
    try {
      const { listCycleDateAsksDueAction } = await import(
        "@/lib/server-actions/cycle-date-collector"
      );
      const r = await listCycleDateAsksDueAction();
      if (!r.ok) setError(r.error);
      else setFlags(r.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFlags();
  }, []);

  async function handleSend(clientId: string) {
    setSendingId(clientId);
    setSendErrors((p) => ({ ...p, [clientId]: "" }));
    try {
      const { sendCycleDateCheckAction } = await import(
        "@/lib/server-actions/cycle-date-collector"
      );
      const r = await sendCycleDateCheckAction(clientId);
      if (!r.ok) {
        setSendErrors((p) => ({ ...p, [clientId]: r.error || "Send failed" }));
      } else {
        setSentIds((p) => new Set(p).add(clientId));
      }
    } catch (e) {
      setSendErrors((p) => ({
        ...p,
        [clientId]: e instanceof Error ? e.message : "Failed",
      }));
    } finally {
      setSendingId(null);
    }
  }

  if (flags && flags.length === 0 && !loading && !error) return null;

  return (
    <FmPanel
      title="🩸 Period-date checks due"
      subtitle="Cycling clients whose next period is due — ask for the date to keep cycle-timed tests accurate"
    >
      <div style={{ display: "grid", gap: 10 }}>
        {!whatsappConfigured && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(234, 88, 12, 0.06)",
              border: "1px solid rgba(234, 88, 12, 0.22)",
              fontSize: 12,
            }}
          >
            <strong>WhatsApp outbound not configured.</strong> The send button
            is disabled until the WhatsApp server env vars are set. You can
            still see the list and ask manually.
          </div>
        )}

        {loading && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>}
        {error && <div style={{ fontSize: 12, color: "#dc2626" }}>{error}</div>}

        {flags && flags.length > 0 && (
          <ul
            style={{
              display: "grid",
              gap: 8,
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {flags.map((f) => {
              // Persisted-sent state: trust the YAML-backed
              // last_cycle_ask_sent timestamp on the flag record so a
              // coach reloading the dashboard hours/days later still
              // sees which asks have already gone out. The ephemeral
              // sentIds Set keeps the freshly-clicked rows in-sync
              // until the next data refresh — without this OR the YAML
              // field, the chip flashed "✓ Check sent" once then
              // reverted to a button at the next render. Durable rule:
              // feedback-send-buttons-persist-state.
              const sent = sentIds.has(f.client_id) || Boolean(f.last_cycle_ask_sent);
              const sendErr = sendErrors[f.client_id];
              return (
                <li
                  key={f.client_id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(190, 24, 93, 0.05)",
                    border: "1px solid rgba(190, 24, 93, 0.2)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <a
                        href={`/clients-v2/${f.client_id}`}
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "#0369a1",
                          textDecoration: "none",
                        }}
                      >
                        {f.display_name || f.client_id}
                      </a>
                      <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>
                        — period {f.days_overdue === 0
                          ? "due today"
                          : `${f.days_overdue} day${f.days_overdue === 1 ? "" : "s"} overdue`}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {sent ? (
                        <>
                          <FmChip tone="success">
                            ✓ Sent {f.last_cycle_ask_sent ? relativeTimeShort(f.last_cycle_ask_sent) : "just now"}
                          </FmChip>
                          <button
                            type="button"
                            onClick={() => {
                              const ago = f.last_cycle_ask_sent
                                ? relativeTimeShort(f.last_cycle_ask_sent)
                                : "just now";
                              if (confirm(`Cycle-date check already sent ${ago}. Send again?`)) {
                                void handleSend(f.client_id);
                              }
                            }}
                            disabled={!whatsappConfigured || sendingId === f.client_id || !f.mobile_number}
                            style={{
                              fontSize: 11,
                              padding: "3px 7px",
                              background: "transparent",
                              border: "1px solid var(--fm-border)",
                              borderRadius: 6,
                              cursor: "pointer",
                              color: "var(--fm-text-secondary)",
                            }}
                          >
                            ↻ Resend
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSend(f.client_id)}
                          disabled={
                            !whatsappConfigured ||
                            sendingId === f.client_id ||
                            !f.mobile_number
                          }
                          title={
                            !f.mobile_number
                              ? "No mobile number on file"
                              : undefined
                          }
                          style={{
                            fontSize: 12,
                            padding: "5px 9px",
                            borderRadius: 5,
                            background:
                              !whatsappConfigured || !f.mobile_number
                                ? "rgba(0,0,0,0.1)"
                                : "#be185d",
                            color: "white",
                            border: "none",
                            cursor:
                              !whatsappConfigured ||
                              sendingId === f.client_id ||
                              !f.mobile_number
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {sendingId === f.client_id ? "…" : "📲 Send check"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Last period {formatHuman(f.last_menstrual_period)} ·{" "}
                    {f.cycle_length_days}-day cycle · next expected{" "}
                    {formatHuman(f.next_expected)}
                  </div>
                  {sendErr && (
                    <div style={{ fontSize: 11, color: "#dc2626" }}>
                      {sendErr}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FmPanel>
  );
}
