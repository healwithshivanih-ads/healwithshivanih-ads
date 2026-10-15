"use client";

/**
 * Programme feedback — the client tells Shivani how the programme went, in her
 * own terms. Asked once per stage (halfway / end / three months on); which
 * stage is due is decided server-side (lib/fmdb/programme-feedback.ts) and
 * arrives as data.feedback.due.
 *
 * FeedbackBanner is the Today-tab prompt; FeedbackOverlay is the form. The
 * coach can also send `/app/<token>?feedback=1`, which opens the form directly
 * (handled in ochre-app.tsx) — that is how a client whose plan has already
 * ended gets asked.
 */

import { useState } from "react";
import { Icon, useOchre } from "./ochre-context";
import { FEEDBACK_PARTS, GOAL_CHANGE, type FeedbackStage, type TestimonialConsent } from "@/lib/fmdb/programme-feedback";

const COPY: Record<FeedbackStage, { eyebrow: string; title: string; intro: (coach: string) => string; banner: string }> = {
  midpoint: {
    eyebrow: "Halfway · about 2 minutes",
    title: "How is it going so far?",
    intro: (c) => `You're halfway through. Tell ${c} what's helping and what isn't, while there's still time to change it.`,
    banner: "You're halfway. How is it going so far?",
  },
  graduation: {
    eyebrow: "Your programme · about 3 minutes",
    title: "How did we do?",
    intro: (c) => `Your honest answers shape how ${c} works with you and with everyone after you. There are no wrong answers.`,
    banner: "How did we do? Three minutes to tell Shivani.",
  },
  followup: {
    eyebrow: "Three months on · about 2 minutes",
    title: "Has it held?",
    intro: (c) => `It's been a few months since your programme ended. ${c} would love to know how things are now.`,
    banner: "Three months on: has it held?",
  },
};

const RECOMMEND = Array.from({ length: 11 }, (_, i) => i);

export function FeedbackBanner({ onOpen }: { onOpen: () => void }) {
  const data = useOchre();
  const stage = data.feedback?.due;
  if (!stage) return null;
  return (
    <button className="fb-banner" onClick={onOpen}>
      <span className="fb-banner-text">{COPY[stage].banner}</span>
      <span className="fb-banner-cta">
        Share <Icon name="arrowRight" size={15} />
      </span>
    </button>
  );
}

export function FeedbackOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const coach = data.coach.name.split(" ")[0];
  // Fall back to the end-of-programme form if the coach's link is opened when
  // nothing is formally due — an unprompted answer is still worth having.
  const stage: FeedbackStage = data.feedback?.due ?? "graduation";
  const copy = COPY[stage];
  const goals = data.feedback?.goals ?? [];
  const verdict = stage !== "midpoint";

  const [goalChange, setGoalChange] = useState<Record<number, number>>({});
  const [parts, setParts] = useState<Record<string, number>>({});
  const [recommend, setRecommend] = useState<number | null>(null);
  const [biggest, setBiggest] = useState("");
  const [hardest, setHardest] = useState("");
  const [oneThing, setOneThing] = useState("");
  const [consent, setConsent] = useState<TestimonialConsent | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const answered =
    Object.keys(goalChange).length > 0 ||
    Object.keys(parts).length > 0 ||
    recommend !== null ||
    !!(biggest.trim() || hardest.trim() || oneThing.trim());

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/app-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: data.token,
          stage,
          week: data.client.week,
          goals: goals.map((g, i) => ({ goal: g, change: goalChange[i] ?? null })),
          parts: Object.fromEntries(FEEDBACK_PARTS.map((p) => [p.id, parts[p.id] ?? null])),
          recommend,
          biggest_change: biggest,
          hardest,
          change_one_thing: oneThing,
          testimonial: consent ?? "no",
        }),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
      setDone(true);
    } catch (e) {
      setError(
        `Couldn't send that just now. Please check your connection and try again. ` +
          `(${e instanceof Error ? e.message : "network error"})`,
      );
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="overlay-scroll">
        <div className="overlay-pad">
          <div className="center-state" style={{ paddingTop: 50 }}>
            <span className="ring">
              <Icon name="check" size={30} />
            </span>
            <h3>Thank you, {data.client.firstName}</h3>
            <p>{coach} reads every answer herself.</p>
          </div>
          <button className="submit-btn" onClick={() => window.location.reload()}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Back
      </button>
      <div className="overlay-pad">
        <div className="eyebrow">{copy.eyebrow}</div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
          {copy.title}
        </h2>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 10 }}>
          {copy.intro(coach)}
        </p>

        {goals.length > 0 && (
          <div className="q-block">
            <div className="q-label">The things you came in for</div>
            <div className="q-hint">How much has each one changed since you started?</div>
            <div className="card" style={{ padding: "4px 14px" }}>
              {goals.map((g, i) => (
                <div className="adh-item" key={i}>
                  <div className="an">{g}</div>
                  <div className="fb-chips">
                    {GOAL_CHANGE.map((o) => (
                      <button
                        key={o.v}
                        className={goalChange[i] === o.v ? "on" : ""}
                        aria-pressed={goalChange[i] === o.v}
                        onClick={() => setGoalChange({ ...goalChange, [i]: o.v })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="q-block">
          <div className="q-label">How helpful was each part?</div>
          <div className="q-hint">1 is not helpful, 5 is very helpful. Skip anything you didn&apos;t use.</div>
          <div className="card" style={{ padding: "4px 14px" }}>
            {FEEDBACK_PARTS.map((p) => (
              <div className="adh-item" key={p.id}>
                <div className="an">{p.label}</div>
                <div className="seg">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={parts[p.id] === n ? "on" : ""}
                      aria-pressed={parts[p.id] === n}
                      onClick={() => {
                        // tap the chosen number again to clear it
                        const next = { ...parts };
                        if (next[p.id] === n) delete next[p.id];
                        else next[p.id] = n;
                        setParts(next);
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {verdict && (
          <div className="q-block">
            <div className="q-label">How likely are you to recommend {coach} to a friend?</div>
            <div className="fb-scale" role="radiogroup" aria-label="Likelihood to recommend, 0 to 10">
              {RECOMMEND.map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={recommend === n}
                  className={recommend === n ? "on" : ""}
                  onClick={() => setRecommend(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="dots5-cap">
              <span>Not likely</span>
              <span>Very likely</span>
            </div>
          </div>
        )}

        <div className="q-block">
          <div className="q-label">{verdict ? "What has changed most for you?" : "What's helping most so far?"}</div>
          <textarea className="journal" rows={3} value={biggest} onChange={(e) => setBiggest(e.target.value)} />
        </div>

        {verdict && (
          <div className="q-block">
            <div className="q-label">What was hardest?</div>
            <textarea className="journal" rows={3} value={hardest} onChange={(e) => setHardest(e.target.value)} />
          </div>
        )}

        <div className="q-block">
          <div className="q-label">
            {verdict ? "If you could change one thing about how we work, what would it be?" : "What would make the next few weeks easier?"}
          </div>
          <textarea className="journal" rows={3} value={oneThing} onChange={(e) => setOneThing(e.target.value)} />
        </div>

        {verdict && (
          <div className="q-block">
            <div className="q-label">May {coach} share your words?</div>
            <div className="q-hint">Only what you wrote above, never your health details.</div>
            <div className="fb-consent">
              {(
                [
                  ["named", "Yes, with my first name"],
                  ["anonymous", "Yes, without my name"],
                  ["no", "No, keep it private"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={consent === v ? "on" : ""} aria-pressed={consent === v} onClick={() => setConsent(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="checkin-error">{error}</div>}

        <button className="submit-btn" disabled={!answered || sending} onClick={submit}>
          {sending ? "Sending…" : answered ? `Send to ${coach}` : "Answer any question to send"}
        </button>
        <div className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}>
          Only {coach} reads your answers
        </div>
      </div>
    </div>
  );
}
