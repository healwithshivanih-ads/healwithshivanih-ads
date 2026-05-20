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

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  loadWhatsAppThreadAction,
  sendWhatsAppTextAction,
  recordOutboundMessageAction,
  type ChatThreadMessage,
} from "@/app/api/whatsapp/actions";

interface Props {
  clientId: string;
  clientName?: string;
  clientPhone?: string;
  /** Days back to scan (default 90). */
  daysBack?: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

// All chat timestamps are pinned to IST (Asia/Kolkata) so the thread
// reads correctly regardless of the viewer's browser timezone — a bare
// toLocale* would otherwise drift on a non-IST machine. Matches the
// /messages inbox, which pins the same way.
const IST = "Asia/Kolkata";

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
      timeZone: IST,
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** YYYY-MM-DD of an ISO timestamp as seen in IST. */
function istDayKey(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    // en-CA → ISO-ish YYYY-MM-DD ordering.
    return d.toLocaleDateString("en-CA", { timeZone: IST });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Group consecutive messages by date so we can show "—— 14 May ——"
 * separators between days. Day boundaries are computed in IST so a
 * message sent late-evening doesn't land under the wrong calendar day.
 */
function groupByDay(msgs: ChatThreadMessage[]): Array<{ day: string; items: ChatThreadMessage[] }> {
  const out: Array<{ day: string; items: ChatThreadMessage[] }> = [];
  for (const m of msgs) {
    const day = istDayKey(m.date || "");
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
    // `day` is already an IST calendar date — render it as a plain
    // local date (no timeZone shift; it carries no time component).
    const d = new Date(day + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", weekday: "short" });
  } catch {
    return day;
  }
}

export function WhatsAppThreadPanel({ clientId, clientName, clientPhone, daysBack = 90 }: Props) {
  const [messages, setMessages] = useState<ChatThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [sending, setSending] = useState(false);

  // 24-hour conversation window — derived from the most recent inbound
  // message. Meta allows free-text only within 24h of client's last
  // message; outside it requires an approved template.
  const within24h = useMemo(() => {
    const lastInbound = messages
      .filter((m) => m.direction === "inbound")
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastInbound?.date) return false;
    try {
      return Date.now() - new Date(lastInbound.date).getTime() < WINDOW_MS;
    } catch {
      return false;
    }
  }, [messages]);

  const lastInboundAt = useMemo(() => {
    const lastInbound = messages
      .filter((m) => m.direction === "inbound")
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return lastInbound?.date ?? null;
  }, [messages]);

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

    // Instant refresh when MessageTemplatesPanel fires after a successful
    // outbound send — the green bubble shows up in <1s instead of waiting
    // up to 30s for the next poll. Inbound replies still rely on polling
    // since we don't know when one lands.
    const onSent = (e: Event) => {
      const detail = (e as CustomEvent<{ clientId?: string }>).detail;
      if (!detail?.clientId || detail.clientId === clientId) {
        void refresh();
      }
    };
    window.addEventListener("whatsapp-message-sent", onSent);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("whatsapp-message-sent", onSent);
    };
  }, [refresh, clientId]);

  const grouped = groupByDay(messages);
  const firstName = (clientName ?? "").split(" ")[0] || "this client";

  const handleReplySend = async () => {
    if (!clientPhone || !replyText.trim()) return;
    setSending(true);
    setReplyStatus(null);
    const res = await sendWhatsAppTextAction(clientPhone, replyText.trim(), {
      name: clientName,
    });
    if (res.ok) {
      // Log + clear + instant-refresh via the same event the templates
      // panel uses, so the bubble shows up in <1s.
      try {
        await recordOutboundMessageAction({
          clientId,
          templateName: "(free-text reply)",
          renderedBody: replyText.trim(),
        });
      } catch {
        /* silent — best effort */
      }
      setReplyText("");
      setReplyStatus({ ok: true });
      void refresh();
      // Auto-dismiss success badge after 3s
      setTimeout(() => setReplyStatus(null), 3000);
    } else {
      setReplyStatus({ ok: false, error: res.error });
    }
    setSending(false);
  };

  const onReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter / Ctrl+Enter to send — Enter alone is newline
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleReplySend();
    }
  };

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
                      fontSize: 13,
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
                        fontSize: 10,
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

      {/* ── Reply box ── Only shown when within Meta's 24-hour
          conversation window (last inbound message <24h old). Outside
          that window, the WA server returns error 131047 and free-text
          is blocked — coach must use a template from the panel above. */}
      {clientPhone && within24h && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "var(--fm-surface)",
            border: "1px solid rgba(37,211,102,0.30)",
            borderRadius: "var(--fm-radius-sm)",
            display: "grid",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "#0E6B3E",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            💬 Reply to {firstName}
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                color: "var(--fm-text-tertiary)",
                letterSpacing: 0,
                textTransform: "none",
              }}
            >
              within 24-hr conversation window
            </span>
          </div>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={onReplyKeyDown}
            placeholder={`Type a reply to ${firstName}… (⌘+Enter to send)`}
            rows={3}
            disabled={sending}
            style={{
              width: "100%",
              fontSize: 13,
              padding: "6px 8px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleReplySend}
              disabled={sending || !replyText.trim()}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "5px 12px",
                background: replyText.trim() && !sending ? "#25D366" : "var(--fm-border)",
                color: "#fff",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: sending || !replyText.trim() ? "not-allowed" : "pointer",
              }}
            >
              {sending ? "Sending…" : "📤 Send"}
            </button>
            {replyStatus?.ok && (
              <span style={{ fontSize: 11, color: "#0E6B3E", fontWeight: 600 }}>
                ✓ Sent
              </span>
            )}
            {replyStatus?.ok === false && (
              <span style={{ fontSize: 11, color: "#991b1b", fontWeight: 600 }}>
                {replyStatus.error}
              </span>
            )}
          </div>
        </div>
      )}

      {clientPhone && !within24h && lastInboundAt && (
        <div
          style={{
            marginTop: 4,
            padding: "7px 10px",
            background: "rgba(245, 158, 11, 0.06)",
            border: "1px dashed rgba(245, 158, 11, 0.35)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 11,
            color: "#92400e",
            lineHeight: 1.5,
          }}
        >
          ⏰ Free-text reply window closed.{" "}
          {(() => {
            try {
              const d = new Date(lastInboundAt);
              const closedAt = new Date(d.getTime() + WINDOW_MS);
              const fmt = (x: Date) =>
                x.toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                });
              return (
                <>
                  {firstName}&apos;s last message was{" "}
                  <strong>{fmt(d)}</strong>; the 24-hour window closed{" "}
                  <strong>{fmt(closedAt)}</strong>.
                </>
              );
            } catch {
              return `${firstName}'s last message was over 24h ago.`;
            }
          })()}{" "}
          The window only reopens when {firstName} sends a new message — it
          does <strong>not</strong> reset on its own or when you send a
          template. To message now, use an approved template from the
          &quot;Send message&quot; panel above.
        </div>
      )}

      {clientPhone && !within24h && !lastInboundAt && messages.length > 0 && (
        <div
          style={{
            marginTop: 4,
            padding: "7px 10px",
            background: "rgba(59, 130, 246, 0.06)",
            border: "1px dashed rgba(59, 130, 246, 0.35)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 11,
            color: "#1e40af",
            lineHeight: 1.5,
          }}
        >
          💬 Free-text reply opens once {firstName} messages back. Meta&apos;s 24-hour
          conversation window only starts on an inbound message — until then,
          send approved templates from the &quot;Send message&quot; panel above.
        </div>
      )}

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
