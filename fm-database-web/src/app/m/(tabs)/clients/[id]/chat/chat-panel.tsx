"use client";

/**
 * The conversation, and the box to reply in.
 *
 * Client component because a chat needs optimistic append — waiting for a
 * round trip before the message appears makes the app feel broken on a phone
 * with poor signal.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../../ui";
import {
  loadClientChatAction,
  markChatReadAction,
  sendCoachMessageAction,
} from "@/lib/server-actions/client-chat";
import type { ThreadView } from "@/lib/fmdb/client-thread";

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
        " · " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ChatPanel({
  clientId,
  firstName,
  initial,
}: {
  clientId: string;
  firstName: string;
  initial: ThreadView[];
}) {
  const [msgs, setMsgs] = useState<ThreadView[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Opening the conversation IS reading it.
  useEffect(() => {
    void markChatReadAction(clientId);
  }, [clientId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);
    // Optimistic: show it immediately, reconcile from the server after.
    const pending: ThreadView = {
      id: `pending-${Date.now()}`,
      at: new Date().toISOString(),
      dir: "outbound",
      text,
      via: "app",
      kind: "text",
    };
    setMsgs((m) => [...m, pending]);
    try {
      const res = await sendCoachMessageAction(clientId, text);
      if (!res.ok) {
        setMsgs((m) => m.filter((x) => x.id !== pending.id));
        setDraft(text); // don't lose what was typed
        setError(res.error ?? "Couldn't send.");
      } else {
        const fresh = await loadClientChatAction(clientId);
        if (fresh.ok) setMsgs(fresh.messages);
      }
    } catch {
      setMsgs((m) => m.filter((x) => x.id !== pending.id));
      setDraft(text);
      setError("Couldn't send — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, paddingBottom: 8 }}>
        {msgs.length === 0 ? (
          <div className="m-card">
            <span className="m-subtle">
              No messages yet. Anything you send here appears in {firstName}&apos;s app.
            </span>
          </div>
        ) : (
          msgs.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: m.dir === "outbound" ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div style={{ maxWidth: "84%" }}>
                <div className={`m-bubble m-bubble--${m.dir === "outbound" ? "you" : "ai"}`}>
                  {m.text}
                  {m.file ? (
                    <div className="m-subtle" style={{ marginTop: 4 }}>
                      [{m.kind}] {m.file}
                    </div>
                  ) : null}
                </div>
                <div
                  className="m-subtle"
                  style={{
                    fontSize: 10,
                    marginTop: 3,
                    textAlign: m.dir === "outbound" ? "right" : "left",
                  }}
                >
                  {when(m.at)}
                  {/* The channel matters: WhatsApp costs money and expires. */}
                  {m.via === "whatsapp" ? " · WhatsApp" : ""}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error ? (
        <div className="m-note m-note--danger" style={{ marginBottom: 8 }}>
          {error}
        </div>
      ) : null}

      <form onSubmit={send} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="m-field"
          placeholder={`Reply to ${firstName}`}
          aria-label={`Reply to ${firstName}`}
        />
        <button
          type="submit"
          className="fm-btn primary"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          style={{ padding: "0 14px" }}
        >
          <Icon name="send" size="sm" />
        </button>
      </form>
      <p className="m-subtle" style={{ margin: "8px 2px 0" }}>
        Sent in the app — no WhatsApp charge, no 24-hour window.
      </p>
    </>
  );
}
