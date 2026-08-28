"use client";

/**
 * EmailComposePanel — real compose-and-send email, replacing the old
 * `mailto:` link on the Communicate tab.
 *
 * The mailto link opened the coach's own local Mail app: nothing sent that
 * way was ever recorded anywhere, so the most-used path for ad-hoc personal
 * notes — the content most in need of continuity — was invisible in the
 * client's communication thread. This sends via the app's configured mailer
 * (sendClientEmailAction → clientMailer()) and logs the send with
 * recordOutboundMessageAction({channel: "email"}), same pattern as the
 * WhatsApp template panel's send-and-record flow.
 *
 * CONTEXT-CONTINUITY: before the coach writes anything, this loads the last
 * few messages from the merged communication thread (any channel) via
 * loadClientChatAction and shows them above the compose box — the same
 * "scroll up before you reply" instinct a human has in a chat app. This is
 * deliberately just visibility, not a summary: reading the last few messages
 * covers most of what continuity is for.
 *
 * HOOK FOR FUTURE AI-DRAFTED EMAIL: there is no AI email-drafting feature
 * yet. When one is built, it should call loadClientChatAction(clientId, 90)
 * (or whatever window makes sense) the same way loadRecentContext() does
 * below, and hand the last N messages to the drafting prompt as context —
 * don't draft blind. draftFollowUpMessageAction (src/lib/server-actions,
 * WhatsApp follow-up drafts) is the closest existing pattern to model a
 * Haiku-drafted email off, but it doesn't thread recent messages into its
 * prompt today either — that's the gap to close together with this one.
 */

import { useEffect, useState, useCallback } from "react";
import { sendClientEmailAction } from "@/app/api/email/actions";
import { recordOutboundMessageAction } from "@/app/api/whatsapp/actions";
import { loadClientChatAction } from "@/lib/server-actions/client-chat";
import type { ThreadView } from "@/lib/fmdb/client-thread";
import { FmPanel } from "@/components/fm";

interface Props {
  clientId: string;
  clientEmail: string;
  clientName: string;
}

const RECENT_COUNT = 5;

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function channelLabel(via: ThreadView["via"]): string {
  if (via === "email") return "✉ email";
  if (via === "app") return "📲 app";
  return "💬 WhatsApp";
}

function htmlWrap(body: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #222;">${body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 12px 0;">${para.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

export function EmailComposePanel({ clientId, clientEmail, clientName }: Props) {
  const firstName = clientName.split(" ")[0] || "there";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const [recent, setRecent] = useState<ThreadView[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecentContext = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await loadClientChatAction(clientId, 90);
      setRecent(res.messages.slice(-RECENT_COUNT).reverse());
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadRecentContext();
  }, [loadRecentContext]);

  const handleSend = async () => {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) {
      setSendResult({ ok: false, error: "Subject and message are both required." });
      return;
    }
    setSending(true);
    setSendResult(null);

    const res = await sendClientEmailAction({
      to: clientEmail,
      subject: trimmedSubject,
      htmlBody: htmlWrap(trimmedBody),
      textBody: trimmedBody,
    });
    setSending(false);
    setSendResult(res);

    if (res.ok) {
      try {
        const rec = await recordOutboundMessageAction({
          clientId,
          templateName: "(free-text reply)",
          renderedBody: `Subject: ${trimmedSubject}\n\n${trimmedBody}`,
          channel: "email",
        });
        if (!rec.ok) {
          setSendResult({
            ok: false,
            error: `Sent ✓ but failed to record locally: ${rec.error ?? "unknown"}. The client received the email; it won't show in the thread below until the record retry succeeds.`,
          });
          console.error("[email-compose] recordOutbound failed:", rec.error);
        } else {
          setSubject("");
          setBody("");
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("whatsapp-message-sent", { detail: { clientId } }));
          }
          void loadRecentContext();
        }
      } catch (e) {
        setSendResult({
          ok: false,
          error: `Sent ✓ but record threw: ${(e as Error).message}. Client received the email; thread won't reflect it.`,
        });
        console.error("[email-compose] recordOutbound threw:", e);
      }
    }
  };

  return (
    <FmPanel
      title="✉️ Email client"
      subtitle="Compose and send — recorded in the Communicate thread like every other message."
    >
      {/* Recent context — read before you write, the same way you'd scroll
          up in a chat app before replying. */}
      <div style={{ marginBottom: 12 }}>
        <p
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--fm-text-tertiary)",
            margin: "0 0 6px",
          }}
        >
          Recent conversation
        </p>
        {recentLoading ? (
          <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>Loading…</p>
        ) : recent.length === 0 ? (
          <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
            No prior messages with {firstName} yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 4, maxHeight: 140, overflowY: "auto" }}>
            {recent.map((m) => (
              <div
                key={m.id}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  background: "var(--fm-bg-cool)",
                  borderRadius: "var(--fm-radius-sm)",
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                }}
              >
                <span style={{ fontWeight: 700, color: m.dir === "outbound" ? "var(--fm-primary)" : "var(--fm-text-secondary)", flexShrink: 0 }}>
                  {m.dir === "outbound" ? "You" : firstName}
                </span>
                <span style={{ color: "var(--fm-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {m.text || "(attachment)"}
                </span>
                <span style={{ color: "var(--fm-text-tertiary)", flexShrink: 0, fontSize: 10 }}>
                  {channelLabel(m.via)} · {fmtWhen(m.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compose form */}
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", fontWeight: 600 }}>To</span>
          <input
            type="text"
            value={clientEmail}
            disabled
            style={{
              padding: "6px 8px",
              fontSize: 12,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              background: "var(--fm-bg-cool)",
              color: "var(--fm-text-secondary)",
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", fontWeight: 600 }}>Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="A quick note"
            style={{
              padding: "6px 8px",
              fontSize: 12,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", fontWeight: 600 }}>Message</span>
          <textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Hi ${firstName}, ...`}
            style={{
              padding: "8px",
              fontSize: 13,
              lineHeight: 1.5,
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !subject.trim() || !body.trim()}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: sending || !subject.trim() || !body.trim() ? "var(--fm-border)" : "var(--fm-primary)",
              border: "none",
              borderRadius: "var(--fm-radius-sm)",
              cursor: sending || !subject.trim() || !body.trim() ? "not-allowed" : "pointer",
            }}
          >
            {sending ? "Sending…" : "✉ Send email"}
          </button>
          {sendResult?.ok && (
            <span style={{ fontSize: 11, color: "#0E6B3E", fontWeight: 600 }}>✓ Sent</span>
          )}
        </div>
        {sendResult && !sendResult.ok && (
          <p
            style={{
              fontSize: 11,
              color: "#991b1b",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "var(--fm-radius-sm)",
              padding: "6px 8px",
              margin: 0,
            }}
          >
            ⚠ {sendResult.error}
          </p>
        )}
      </div>
    </FmPanel>
  );
}
