"use client";

/**
 * The ask box as the client sees it: the tappable questions on Home, and the
 * thread of questions and answer cards.
 *
 * Every answer is an AskCard (src/lib/fmdb/ask-card.ts), wherever it came
 * from. This file only draws cards and reports taps; what a question becomes
 * is decided in sq-ask.ts (the router) and, for the model, on the server.
 *
 * Copy rule: the app says "your coach", never the coach's name.
 */

import { useEffect, useRef, useState } from "react";
import { NO_ANSWER_CARD, coachCard, handoffCard, urgentCard, type AskButton, type AskCard } from "@/lib/fmdb/ask-card";
import { HANDOFF_COPY, REPLY_LINE, type HandoffKind } from "@/lib/fmdb/ask-safety";
import { SqIcon } from "./sq-ui";

/** One question and what came back. `card` is null while the model is asked. */
export interface AskTurn {
  id: number;
  q: string;
  card: AskCard | null;
  /** the hand-off to the coach: not offered or not taken, going, gone, failed */
  send: "idle" | "sending" | "sent" | "failed";
}

/** Shown when the phone could not reach the server at all. */
export const OFFLINE_CARD: AskCard = coachCard("I couldn't get an answer just now. You can ask again, or send this to your coach.");

/** Shown when the day's typed questions are used up (the server's cap). The
 *  tappable questions and the plan lookups are not counted and still work. */
export const LIMIT_CARD: AskCard = coachCard(
  "That is all the typed questions I can answer today. The questions on Today still work, and I can pass this one to your coach.",
);

/**
 * Ask the model, by way of the server. Always resolves to a card: the server
 * has already checked the model's words, and anything that goes wrong here
 * becomes an offer to send the question to the coach.
 */
export async function fetchModelCard(token: string, question: string): Promise<AskCard> {
  try {
    const res = await fetch("/api/app-copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, question, format: "card" }),
    });
    const j = (await res.json()) as { ok?: boolean; verdict?: string; card?: AskCard; reason?: string };
    if (!res.ok || !j.ok) return NO_ANSWER_CARD;
    if (j.verdict === "answer" && j.card && Array.isArray(j.card.lines)) {
      if (j.card.autoCheck) {
        // The coach checks every automatic answer: the question lands in the
        // client's own Coach thread, where she can see it went.
        void fetch("/api/app-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, action: "send", text: `${question.trim()}\n\n(Automatic answer in the app: "${j.card.heading ?? j.card.lines[0]}". Please check.)` }),
        }).catch(() => {});
      }
      return j.card;
    }
    if (j.verdict === "emergency" || j.verdict === "selfharm") return urgentCard(j.verdict);
    if (j.reason && j.reason in HANDOFF_COPY) return handoffCard(j.reason as HandoffKind);
    if (j.reason === "limit") return LIMIT_CARD;
    return NO_ANSWER_CARD;
  } catch {
    return OFFLINE_CARD;
  }
}

/** The words sent to the coach when a question is handed over. */
export function handoffText(q: string, week: number, totalWeeks: number): string {
  return `${q.trim()}\n\n(Asked in the app · week ${week} of ${totalWeeks})`;
}

// ── Home ───────────────────────────────────────────────────────────────────

export function SqAskBox({ chips, onAsk }: { chips: string[]; onAsk: (q: string) => void }) {
  return (
    <section className="sq-askb">
      <h2 className="sq-ask-h">Ask anything about your plan</h2>
      <p className="sq-ask-sub">A dish, a restaurant, what is left today. Medicines, doses and symptoms go to your coach.</p>
      <div className="sq-chips">
        {chips.map((c) => (
          <button key={c} type="button" className="sq-chip" onClick={() => onAsk(c)}>
            {c}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── one answer ─────────────────────────────────────────────────────────────

function SqAnswer({
  turn,
  live,
  onButton,
  onSend,
  onNotNow,
  onAsk,
}: {
  turn: AskTurn;
  /** the newest answer: only it offers actions that change something */
  live: boolean;
  onButton: (b: AskButton) => void;
  onSend: (turn: AskTurn) => void;
  onNotNow: () => void;
  onAsk: (q: string) => void;
}) {
  const card = turn.card;
  if (!card) return null;

  if (turn.send === "sent") {
    return (
      <section className="sq-card sq-ans">
        <div className="sq-src">Sent to your coach</div>
        <p>Your coach has your question. {REPLY_LINE} The reply will be in the Coach tab.</p>
        <div className="sq-row-btns">
          <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={() => onButton({ to: "coach", label: "Open Coach" })}>
            Open Coach
          </button>
        </div>
      </section>
    );
  }

  const urgent = card.tone === "urgent";
  return (
    <section className={"sq-card sq-ans" + (urgent ? " sq-urgent" : "")} role={urgent ? "alert" : undefined}>
      <div className="sq-src">
        {card.handoff && (
          <span className="sq-av-s" aria-hidden="true">
            C
          </span>
        )}
        {card.src}
      </div>
      {card.heading && <h3>{card.heading}</h3>}
      {card.lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {card.list && card.list.length > 0 && (
        <ul className="sq-yn">
          {card.list.map((item, i) => (
            <li key={i} className={"sq-yn-" + item.mark}>
              {item.mark === "dot" ? <span className="sq-dot" aria-hidden="true" /> : <SqIcon name={item.mark === "yes" ? "check" : "x"} />}
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      {card.note && <p className="sq-note">{card.note}</p>}

      {(card.buttons?.length || (card.handoff && live)) && (
        <div className="sq-row-btns">
          {(card.buttons ?? []).map((b) => (
            <button
              key={b.to + b.label}
              type="button"
              className={"sq-btn sq-btn-small " + (b.solid ? "sq-btn-solid" : "sq-btn-quiet")}
              onClick={() => onButton(b)}
            >
              {b.label}
            </button>
          ))}
          {card.handoff && live && (
            <>
              <button type="button" className="sq-btn sq-btn-solid sq-btn-small" disabled={turn.send === "sending"} onClick={() => onSend(turn)}>
                {turn.send === "sending" ? "Sending…" : turn.send === "failed" ? "Try again" : "Send to coach"}
              </button>
              <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={onNotNow}>
                Not now
              </button>
            </>
          )}
        </div>
      )}
      {turn.send === "failed" && (
        <p className="sq-note sq-err" role="status">
          Not sent yet. Check your connection and try again.
        </p>
      )}

      {live && card.followUps && card.followUps.length > 0 && (
        <div className="sq-chips sq-chips-in">
          {card.followUps.map((f) => (
            <button key={f} type="button" className="sq-chip" onClick={() => onAsk(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ── the thread ─────────────────────────────────────────────────────────────

export function SqAskView({
  turns,
  onBack,
  onButton,
  onSend,
  onAsk,
}: {
  turns: AskTurn[];
  onBack: () => void;
  onButton: (b: AskButton) => void;
  onSend: (turn: AskTurn) => void;
  onAsk: (q: string) => void;
}) {
  // Only the newest question shows by default; earlier ones are one tap away,
  // so the answer she is waiting for is never under a pile of old ones.
  const [showAll, setShowAll] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const last = turns[turns.length - 1];
  const lastSettled = !!last?.card;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastSettled]);

  const shown = showAll ? turns : turns.slice(-1);
  return (
    <div className="sq-askv">
      <button type="button" className="sq-back" onClick={onBack}>
        <SqIcon name="left" /> Today
      </button>
      {turns.length > 1 && (
        <button type="button" className="sq-link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Hide earlier questions" : "Earlier questions"}
        </button>
      )}
      {shown.map((t) => (
        <div key={t.id} className="sq-turn">
          <div className="sq-me">{t.q}</div>
          {t.card ? (
            <SqAnswer turn={t} live={t.id === last.id} onButton={onButton} onSend={onSend} onNotNow={onBack} onAsk={onAsk} />
          ) : (
            <div className="sq-thinking" role="status">
              <i />
              <i />
              <i />
              Looking at your plan…
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
