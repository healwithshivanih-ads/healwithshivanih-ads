"use client";

/**
 * Coach tab — Shivani first (WhatsApp + next session), then the AI
 * co-pilot. Suggested chips use canned plan-grounded answers (zero API
 * cost). Typed questions are gated client-side (clinical topics defer
 * to the coach) and answered by a tightly-scoped, cost-capped Haiku
 * call via /api/app-copilot.
 */

import { useEffect, useRef, useState } from "react";
import { Icon, useOchre } from "./ochre-context";
import { Accordion, Section } from "./ochre-ui";

const DEFER_HINTS = [
  "dose",
  "dosage",
  "mg",
  "result",
  "blood",
  "tsh",
  "lab",
  "symptom",
  "pain",
  "medication",
  "medicine",
  "pregnan",
  "pause",
  "stop my",
  "side effect",
  "doctor",
  "chest",
  "dizzy",
];

function looksClinical(q: string): boolean {
  const s = q.toLowerCase();
  return DEFER_HINTS.some((h) => s.includes(h));
}

interface Msg {
  who: "ai" | "me";
  text: string;
  defer?: boolean;
}

export function CoachScreen({ coachAlert }: { coachAlert: boolean }) {
  const data = useOchre();
  const c = data.coach;
  const firstName = c.name.split(" ")[0];
  const waLink = `https://wa.me/${c.whatsappNumber}?text=${encodeURIComponent(c.whatsappPrefill)}`;
  const DEFER_MSG = `That’s one for ${firstName} — she’ll want the full picture before answering. Tap below to send it to her on WhatsApp and she’ll reply personally.`;

  const [msgs, setMsgs] = useState<Msg[]>([
    {
      who: "ai",
      text: `Hi ${data.client.firstName} — I can answer quick questions about your plan any time. For anything personal or medical, I’ll pass you to ${firstName}.`,
    },
  ]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [usedChips, setUsedChips] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  const pushDefer = () => setMsgs((m) => [...m, { who: "ai", text: DEFER_MSG, defer: true }]);

  const askChip = (item: { q: string; a: string }, idx: number) => {
    setUsedChips((u) => ({ ...u, [idx]: true }));
    setMsgs((m) => [...m, { who: "me", text: item.q }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, { who: "ai", text: item.a }]);
    }, 650);
  };

  const send = async () => {
    const q = input.trim();
    if (!q || typing) return;
    setInput("");
    setMsgs((m) => [...m, { who: "me", text: q }]);
    if (looksClinical(q)) {
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        pushDefer();
      }, 600);
      return;
    }
    setTyping(true);
    let answer = "";
    try {
      const res = await fetch("/api/app-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, question: q }),
      });
      const out = (await res.json()) as { ok?: boolean; answer?: string };
      if (res.ok && out.ok && out.answer) answer = out.answer.trim();
    } catch {
      /* network — fall through to defer */
    }
    setTyping(false);
    if (!answer || answer.toUpperCase().includes("DEFER")) pushDefer();
    else setMsgs((m) => [...m, { who: "ai", text: answer }]);
  };

  const remainingChips = data.aiSuggested.map((s, i) => ({ s, i })).filter((x) => !usedChips[x.i]);

  return (
    <div className="screen-pad screen-anim" style={{ display: "flex", flexDirection: "column" }}>
      <div className="greeting" style={{ paddingBottom: 4 }}>
        <div className="hi" style={{ fontSize: 24 }}>
          Your coach
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {firstName}, plus a co-pilot for quick questions.
        </div>
      </div>

      <div className="coach-card v2">
        <div className="coach-photo">{c.initials}</div>
        <div style={{ flex: 1 }}>
          <div className="cc-name">{c.name}</div>
          <div className="cc-role">{c.role} · The Ochre Tree</div>
        </div>
        {coachAlert && <span className="cc-badge">Check-in due</span>}
      </div>
      <a className="wa-btn" href={waLink} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>
        <Icon name="whatsapp" size={20} /> Message {firstName} on WhatsApp
      </a>
      {c.nextSession && (
        <div className="next-session" style={{ marginTop: 10 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "var(--ochre-tint)",
              color: "var(--ochre)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="calendar" size={20} />
          </span>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Your next session</div>
            <div style={{ fontSize: 14.5, color: "var(--ink)", fontWeight: 500, marginTop: 1 }}>{c.nextSession}</div>
          </div>
        </div>
      )}

      <Section title="Ask the co-pilot">
        <div className="copilot">
          <div className="cp-thread" ref={scrollRef}>
            {msgs.map((m, i) => (
              <div key={i} className={"bubble " + m.who + (m.defer ? " defer" : "")}>
                {m.who === "ai" && (
                  <span className="cp-spark">
                    <Icon name="bolt" size={13} />
                  </span>
                )}
                <span>{m.text}</span>
              </div>
            ))}
            {typing && (
              <div className="bubble ai">
                <span className="cp-spark">
                  <Icon name="bolt" size={13} />
                </span>
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            {msgs.some((m) => m.defer) && (
              <a className="cp-defer-btn" href={waLink} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" size={16} /> Send to {firstName}
              </a>
            )}
          </div>

          {remainingChips.length > 0 && (
            <div className="cp-chips">
              {remainingChips.map(({ s, i }) => (
                <button key={i} className="cp-chip" onClick={() => askChip(s, i)}>
                  {s.q}
                </button>
              ))}
            </div>
          )}

          <div className="cp-input">
            <input
              className="journal"
              placeholder="Ask about your plan…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button className="cp-send" onClick={() => void send()} disabled={!input.trim() || typing} aria-label="Send">
              <Icon name="send" size={18} />
            </button>
          </div>
          <div className="cp-foot">
            <Icon name="sparkle" size={12} /> Suggested answers are instant. Anything personal or medical goes to {firstName}.
          </div>
        </div>
      </Section>

      <Section title="Common questions">
        <Accordion items={data.faq} />
      </Section>
    </div>
  );
}
