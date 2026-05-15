"use client";

/**
 * WhatsAppThreadPanel — chat-bubble view of all outbound + inbound
 * WhatsApp messages with this client.
 *
 * Outbound: written by recordOutboundMessageAction from the message-
 * templates panel (and by future flows like handover onboarding, cron
 * reminders, etc.) as quick_note sessions tagged
 * `[source: whatsapp_outbound] [template: fm_xxx]`.
 *
 * Inbound: written by the /api/whatsapp-webhook route (self-hosted WA
 * server forwards Meta webhooks) as quick_note sessions tagged
 * `[source: whatsapp_webhook]`.
 *
 * loadWhatsAppThreadAction() merges both, sorts chronologically, returns
 * a list of {direction, date, text, template_name?, session_id?}.
 *
 * UI: right-aligned green bubble for outbound (Shivani's voice), left-
 * aligned grey bubble for inbound (client). Template name shown as a
 * tiny chip on outbound bubbles. Auto-refreshes every 30s while open.
 */

import { useEffect, useState, useCallback } from "react";
import {
  loadWhatsAppThreadAction,
  type ChatThreadMessage,
} from "@/app/api/whatsapp/actions";

interface Props {
  clientId: string;
  clientName?: string;
  /** Days back to scan (default 90). */
  daysBack?: number;
}

function fmtTimestamp(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Group consecutive messages by date so we can show "—— 14 May ——"
 * separators between days.
 */
function groupByDay(msgs: ChatThreadMessage[]): Array<{ day: string; items: ChatThreadMessage[] }> {
  const out: Array<{ day: string; items: ChatThreadMessage[] }> = [];
  for (const m of msgs) {
    const day = (m.date || "").slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.items.push(m);
    } else {
      out.push({ day, items: [m] });
    }
  }
  return out;
}

function fmtDayHeader(day: string): string {
  if (!day) return "";
  try {
    const d = new Date(day + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", weekday: "short" });
  } catch {
    return day;
  }
}

export function WhatsAppThreadPanel({ clientId, clientName, daysBack = 90 }: Props) {
  const [messages, setMessages] = useState<ChatThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadWhatsAppThreadAction(clientId, daysBack);
      setMessages(res);
    } finally {
      setLoading(false);
    }
  }, [clientId, daysBack]);

  useEffect(() => {
    void refresh();
    // Light polling so new inbound replies show up without manual refresh
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const grouped = groupByDay(messages);
  const firstName = (clientName ?? "").split(" ")[0] || "this client";

  if (loading && messages.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)", padding: "10px 12px" }}>
        Loading conversation…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "var(--fm-text-tertiary)",
          padding: "12px 14px",
          background: "var(--fm-bg-cool)",
          borderRadius: "var(--fm-radius-sm)",
        }}
      >
        No WhatsApp messages with {firstName} yet. Outbound sends from the
        Send-message panel above + inbound replies from the client will
        appear here as bubbles.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: "10px 12px",
        background: "linear-gradient(180deg, rgba(37,211,102,0.04), rgba(37,211,102,0.01))",
        borderRadius: "var(--fm-radius-md)",
        maxHeight: 520,
        overflowY: "auto",
      }}
    >
      {grouped.map((g) => (
        <div key={g.day}>
          {/* Day separator */}
          <div
            style={{
              textAlign: "center",
              fontSize: 10,
              color: "var(--fm-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              fontWeight: 700,
              margin: "8px 0 10px",
            }}
          >
            — {fmtDayHeader(g.day)} —
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {g.items.map((m, i) => {
              const isOut = m.direction === "outbound";
              return (
                <div
                  key={`${m.session_id ?? m.date}-${i}`}
                  style={{
                    display: "flex",
                    justifyContent: isOut ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "8px 12px",
                      background: isOut ? "#DCF8C6" : "#fff",
                      border: isOut ? "1px solid rgba(37,211,102,0.30)" : "1px solid var(--fm-border-light)",
                      borderRadius: 12,
                      borderTopRightRadius: isOut ? 4 : 12,
                      borderTopLeftRadius: isOut ? 12 : 4,
                      boxShadow: "0 1px 1.5px rgba(0,0,0,0.04)",
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      color: "var(--fm-text-primary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {/* Template chip — only on outbound */}
                    {isOut && m.template_name && (
                      <div
                        style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#0E6B3E",
                          background: "rgba(37,211,102,0.18)",
                          padding: "1px 6px",
                          borderRadius: 3,
                          letterSpacing: 0.5,
                          marginBottom: 4,
                          textTransform: "lowercase",
                          fontFamily: "var(--fm-font-mono)",
                        }}
                      >
                        {m.template_name}
                      </div>
                    )}

                    <div>{m.text}</div>

                    <div
                      style={{
                        fontSize: 9.5,
                        color: "var(--fm-text-tertiary)",
                        marginTop: 4,
                        textAlign: "right",
                      }}
                    >
                      {fmtTimestamp(m.date)}
                      {isOut && <span style={{ marginLeft: 4 }}>✓</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div
        style={{
          fontSize: 10,
          color: "var(--fm-text-tertiary)",
          textAlign: "center",
          marginTop: 4,
        }}
      >
        ↻ Auto-refresh every 30s
      </div>
    </div>
  );
}
