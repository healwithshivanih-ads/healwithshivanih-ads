"use client";

/**
 * StartDateReminderPanel — dashboard widget that lists every published-plan
 * client who hasn't yet confirmed their actual meal-plan start date.
 *
 * Each row: client name, days since publish, the +3d default we're assuming,
 * and a "📨 Send reminder" button that fires a templated WhatsApp.
 *
 * Inbound responses are picked up by the existing start-date parser in
 * src/lib/start-date-parser.ts (registered in the api/whatsapp-webhook route)
 * and auto-update plan.meal_plan_started_on without coach review — so once
 * the client replies "Started 19 May", the panel clears them automatically.
 *
 * Hidden when WHATSAPP_SERVER_URL is unset — the Send button can't work
 * without an outbound WhatsApp backend configured.
 */

import { useEffect, useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import { relativeTimeShort } from "@/lib/fmdb/session-utils";

interface Flag {
  client_id: string;
  display_name: string | null;
  mobile_number: string | null;
  plan_slug: string;
  plan_published_on: string | null;
  plan_period_start: string | null;
  days_since_published: number | null;
  assumed_meal_start: string | null;
  last_reminder_sent_at: string | null;
}

interface Props {
  whatsappConfigured: boolean;
}

function formatHuman(ymd: string | null): string {
  if (!ymd) return "—";
  try {
    const d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return ymd;
  }
}

export function StartDateReminderPanel({ whatsappConfigured }: Props) {
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
      const { listUnconfirmedStartDatesAction } = await import(
        "@/lib/server-actions/start-date-reminders"
      );
      const r = await listUnconfirmedStartDatesAction(5);
      if (!r.ok) setError(r.error);
      else setFlags(r.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load on mount so coach sees the list without clicking. Cheap —
  // just scans plans + clients YAML, no AI.
  useEffect(() => {
    void loadFlags();
  }, []);

  async function handleSend(clientId: string) {
    setSendingId(clientId);
    setSendErrors((p) => ({ ...p, [clientId]: "" }));
    try {
      const { sendStartDateReminderAction } = await import(
        "@/lib/server-actions/start-date-reminders"
      );
      const r = await sendStartDateReminderAction(clientId);
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

  // Don't render at all if there's nothing to show — saves dashboard space.
  if (flags && flags.length === 0 && !loading && !error) return null;

  return (
    <FmPanel
      title="📅 Start dates not yet confirmed"
      subtitle="Clients running on the default +3d assumption — nudge them to confirm or send a reminder"
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
            <strong>WhatsApp outbound not configured.</strong> Reminder send is
            disabled until <code>WHATSAPP_SERVER_URL</code> +{" "}
            <code>WHATSAPP_SERVER_API_KEY</code> are set in <code>.env.local</code>.
            You can still see the list and chase manually.
          </div>
        )}

        {loading && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>}
        {error && (
          <div style={{ fontSize: 12, color: "#dc2626" }}>{error}</div>
        )}

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
              // Persisted send-state from disk (last [template:
              // fm_start_date_check_v1] segment in the client's sessions)
              // plus this-tab transient state for instant feedback after
              // the coach hits the button. Durable rule:
              // feedback_send_buttons_persist_state.
              const sentThisTab = sentIds.has(f.client_id);
              const persistedSentAt = f.last_reminder_sent_at;
              const sent = sentThisTab || !!persistedSentAt;
              const sentLabel = persistedSentAt
                ? `✓ Sent ${relativeTimeShort(persistedSentAt)}`
                : "✓ Reminder sent";
              const sendErr = sendErrors[f.client_id];
              return (
                <li
                  key={f.client_id + ":" + f.plan_slug}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(245, 158, 11, 0.05)",
                    border: "1px solid rgba(245, 158, 11, 0.2)",
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
                        href={`/clients-v2/${f.client_id}/plan/edit/${f.plan_slug}`}
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "#0369a1",
                          textDecoration: "none",
                        }}
                      >
                        {f.display_name || f.client_id}
                      </a>
                      <span
                        style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}
                      >
                        — {f.days_since_published} days since publish
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {sent ? (
                        <>
                          <FmChip
                            tone="success"
                            title={
                              persistedSentAt
                                ? `Last sent ${new Date(persistedSentAt).toLocaleString()}`
                                : undefined
                            }
                          >
                            {sentLabel}
                          </FmChip>
                          <button
                            type="button"
                            onClick={() => handleSend(f.client_id)}
                            disabled={
                              !whatsappConfigured ||
                              sendingId === f.client_id ||
                              !f.mobile_number
                            }
                            title="Send another reminder now"
                            style={{
                              fontSize: 11,
                              padding: "3px 7px",
                              borderRadius: 4,
                              background: "transparent",
                              color: "#0369a1",
                              border: "1px solid #0369a1",
                              cursor:
                                !whatsappConfigured ||
                                sendingId === f.client_id ||
                                !f.mobile_number
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            {sendingId === f.client_id ? "…" : "↻ Resend"}
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
                            !f.mobile_number ? "No mobile number on file" : undefined
                          }
                          style={{
                            fontSize: 12,
                            padding: "5px 9px",
                            borderRadius: 5,
                            background:
                              !whatsappConfigured || !f.mobile_number
                                ? "rgba(0,0,0,0.1)"
                                : "#059669",
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
                          {sendingId === f.client_id ? "…" : "📨 Send reminder"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Assumed Day 1: {formatHuman(f.assumed_meal_start)}
                    {" · "}
                    Plan: <code>{f.plan_slug}</code>
                  </div>
                  {sendErr && (
                    <div style={{ fontSize: 11, color: "#dc2626" }}>{sendErr}</div>
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
