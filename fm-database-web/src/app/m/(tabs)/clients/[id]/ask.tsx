"use client";

/**
 * "Ask about this client" — the per-client AI chat, on the phone.
 *
 * Talks to /api/m/ask, which answers locally when the authoritative store is
 * on this host (the Mac) and otherwise bridges to the Mac. When neither is
 * available it returns a REASON, which is rendered as-is: a silent empty box
 * would leave the coach retyping a question that can never be answered.
 */
import { useState } from "react";
import { C } from "../../../ui";

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
      if (json.ok) {
        setTurns((t) => [...t, { role: "assistant", content: json.reply }]);
      } else {
        setNotice(json.error ?? "Couldn't get an answer.");
      }
    } catch {
      setNotice("Network error — the answer didn't come back.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {turns.map((t, i) => (
        <div
          key={i}
          style={{
            background: t.role === "user" ? "#F1EEE8" : "#fff",
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            padding: "10px 12px",
            marginBottom: 8,
            fontSize: 15,
            lineHeight: 1.5,
            color: t.role === "user" ? C.body : C.ink,
            whiteSpace: "pre-wrap",
          }}
        >
          {t.content}
        </div>
      ))}

      {busy ? (
        <div style={{ fontSize: 14, color: C.muted, padding: "6px 2px 10px" }}>Thinking…</div>
      ) : null}

      {notice ? (
        <div
          role="status"
          style={{
            background: C.warnBg,
            border: `1px solid #E8D9B0`,
            color: C.warn,
            borderRadius: 11,
            padding: "10px 12px",
            fontSize: 14,
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          {notice}
        </div>
      ) : null}

      <form onSubmit={ask} style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask about ${clientName.split(" ")[0]}…`}
          aria-label="Ask about this client"
          style={{
            flex: 1,
            fontSize: 16,
            padding: "11px 13px",
            borderRadius: 11,
            border: `1px solid ${C.line}`,
            background: "#fff",
          }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          style={{
            minWidth: 60,
            borderRadius: 11,
            border: "none",
            background: busy || !draft.trim() ? "#BFBAB2" : C.ink,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
