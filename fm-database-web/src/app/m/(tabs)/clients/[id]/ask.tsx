"use client";

/**
 * "Ask about this client" — the per-client AI chat, on the phone.
 *
 * Talks to /api/m/ask, which answers locally when the authoritative store is
 * on this host (the Mac) and otherwise bridges to it. When neither is
 * available it returns a REASON, rendered as-is: a silent empty box would
 * leave the coach retyping a question that can never be answered.
 */
import { useState } from "react";
import { Icon } from "../../../ui";

type Turn = { role: "user" | "assistant"; content: string };

export function AskPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    setNotice(null);
    const history = turns.slice();
    setTurns((t) => [...t, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/m/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, question: q, history }),
      });
      const json = await res.json();
      if (json.ok) setTurns((t) => [...t, { role: "assistant", content: json.reply }]);
      else setNotice(json.error ?? "Couldn't get an answer.");
    } catch {
      setNotice("Network error — the answer didn't come back.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {turns.length ? (
        <div className="m-stack" style={{ marginBottom: 12 }}>
          {turns.map((t, i) => (
            <div key={i} className={`m-bubble m-bubble--${t.role === "user" ? "you" : "ai"}`}>
              {t.content}
            </div>
          ))}
        </div>
      ) : null}

      {busy ? (
        <div className="m-subtle" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="m-dot m-dot--primary" />
          Thinking
        </div>
      ) : null}

      {notice ? (
        <div className="m-note m-note--danger" style={{ marginBottom: 12 }}>{notice}</div>
      ) : null}

      <form onSubmit={ask} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="m-field"
          placeholder={`Ask about ${clientName.split(" ")[0]}`}
          aria-label="Ask about this client"
        />
        <button
          type="submit"
          className="fm-btn primary"
          disabled={busy || !draft.trim()}
          aria-label="Ask"
          style={{ padding: "0 14px" }}
        >
          <Icon name="send" size="sm" />
        </button>
      </form>
    </div>
  );
}
