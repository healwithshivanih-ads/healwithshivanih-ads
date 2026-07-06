"use client";

/**
 * Weekly check-in flow + daily feeling / movement bottom sheets.
 * The weekly check-in writes back to the coach (a session lands in
 * ~/fm-plans/clients/<id>/sessions/ via /api/app-checkin); daily
 * quick-logs persist on the phone.
 */

import { useState } from "react";
import { Icon, useOchre } from "./ochre-context";

const RATING_CAP = ["", "Hard", "Low", "Okay", "Good", "Great"];
const ADHERENCE = ["Still taking", "Sometimes", "Stopped"];
const ADHERENCE_P = ["Keeping up", "Sometimes", "Slipped"];

export function CheckinScreen({
  submitted,
  onSubmit,
  onClose,
}: {
  submitted: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const data = useOchre();
  const [rating, setRating] = useState(0);
  const [feel, setFeel] = useState("");
  const [suppAdh, setSuppAdh] = useState<Record<string, number>>({});
  const [pracAdh, setPracAdh] = useState<Record<string, number>>({});
  const [concerns, setConcerns] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (submitted) {
    return (
      <div className="screen-pad screen-anim">
        <CheckinBar onClose={onClose} />
        <div className="center-state" style={{ paddingTop: 50 }}>
          <span className="ring">
            <Icon name="check" size={30} />
          </span>
          <h3>Thank you, {data.client.firstName}</h3>
          <p>Your check-in is saved. {data.coach.name.split(" ")[0]} will read it before your next session.</p>
        </div>
        <div className="card-quiet" style={{ padding: "16px 16px", marginTop: 8 }}>
          <div className="eyebrow">While you wait</div>
          <div className="divider-ochre" />
          <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.55 }}>
            Keep going with today&apos;s plan — it&apos;s all on your Today screen. Your week {Math.min(data.client.week + 1, data.client.totalWeeks)} check-in
            will appear next Sunday.
          </div>
        </div>
      </div>
    );
  }

  const canSubmit = rating > 0 && !sending;

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/app-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: data.token,
          week: data.client.week,
          rating,
          feel,
          concerns,
          supplements: data.supplements.map((s) => ({ name: s.name, status: ADHERENCE[suppAdh[s.id]] ?? null })),
          practices: data.practices.map((p) => ({ name: p.name, status: ADHERENCE_P[pracAdh[p.id]] ?? null })),
        }),
      });
      const out = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
      onSubmit();
    } catch (e) {
      setError(
        `Couldn't reach ${data.coach.name.split(" ")[0]} just now — please check your connection and try again. ` +
          `(${e instanceof Error ? e.message : "network error"})`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="screen-pad screen-anim">
      <CheckinBar onClose={onClose} />
      <div className="checkin-intro">
        <div className="eyebrow">Week {data.client.week} · weekly check-in</div>
        <h2 className="h-serif" style={{ fontSize: 23, margin: "8px 0 4px" }}>
          How has your week been?
        </h2>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: 290, margin: "0 auto" }}>
          A quiet moment to tell {data.coach.name.split(" ")[0]} how you&apos;re really doing. No right answers.
        </p>
      </div>

      <div className="q-block">
        <div className="q-label">How are you feeling overall?</div>
        <div className="dots5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={rating === n ? "on" : ""} onClick={() => setRating(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="dots5-cap">
          <span>Hard week</span>
          <span>{RATING_CAP[rating]}</span>
          <span>Great week</span>
        </div>
        <textarea
          className="journal"
          style={{ marginTop: 14 }}
          rows={3}
          placeholder={`Anything you'd like ${data.coach.name.split(" ")[0]} to know about this week…`}
          value={feel}
          onChange={(e) => setFeel(e.target.value)}
        />
      </div>

      <div className="q-block">
        <div className="q-label">Your supplements</div>
        <div className="q-hint">How did each one go this week?</div>
        <div className="card" style={{ padding: "4px 14px" }}>
          {data.supplements.map((s) => (
            <div className="adh-item" key={s.id}>
              <div className="an">{s.name}</div>
              <div className="seg">
                {ADHERENCE.map((opt, i) => (
                  <button key={i} className={suppAdh[s.id] === i ? "on" : ""} onClick={() => setSuppAdh({ ...suppAdh, [s.id]: i })}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="q-block">
        <div className="q-label">Your daily practices</div>
        <div className="card" style={{ padding: "4px 14px" }}>
          {data.practices.map((p) => (
            <div className="adh-item" key={p.id}>
              <div className="an">{p.name}</div>
              <div className="seg">
                {ADHERENCE_P.map((opt, i) => (
                  <button key={i} className={pracAdh[p.id] === i ? "on" : ""} onClick={() => setPracAdh({ ...pracAdh, [p.id]: i })}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="q-block">
        <div className="q-label">Any new symptoms or concerns?</div>
        <textarea
          className="journal"
          rows={3}
          placeholder="Anything new in your body or mood — even small things…"
          value={concerns}
          onChange={(e) => setConcerns(e.target.value)}
        />
      </div>

      {error && <div className="checkin-error">{error}</div>}

      <button className="submit-btn" disabled={!canSubmit} onClick={submit}>
        {sending ? "Sending…" : canSubmit ? `Send to ${data.coach.name.split(" ")[0]}` : "Choose how you’re feeling to continue"}
      </button>
      <div className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 12, paddingBottom: 4 }}>
        Only {data.coach.name.split(" ")[0]} sees this
      </div>
    </div>
  );
}

function CheckinBar({ onClose }: { onClose: () => void }) {
  return (
    <button className="back-link" onClick={onClose}>
      <Icon name="arrowLeft" size={18} /> Progress
    </button>
  );
}

// ── daily feeling quick-log ──────────────────────────────────────────────────

const FEEL_WORDS = ["", "Drained", "Low", "Steady", "Good", "Bright"];

/** Compact optional number field for the vitals disclosure below. */
function VitalInput({
  placeholder,
  width,
  value,
  onChange,
}: {
  placeholder: string;
  width?: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: width ?? "100%",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "9px 10px",
        fontSize: 15,
        color: "var(--ink)",
        background: "var(--paper)",
        fontFamily: "var(--sans)",
      }}
    />
  );
}

export function DailyFeelingSheet({
  show,
  onClose,
  onSave,
}: {
  show: boolean;
  onClose: () => void;
  onSave: (v: number) => void;
}) {
  const data = useOchre();
  const [v, setV] = useState(0);
  const [saved, setSaved] = useState(false);
  const [showVitals, setShowVitals] = useState(false);
  const [weight, setWeight] = useState("");
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");

  const resetVitals = () => {
    setShowVitals(false);
    setWeight("");
    setBpSys("");
    setBpDia("");
  };

  const submit = () => {
    setSaved(true);
    onSave(v);
    // Best-effort sync to the coach — the mood tap used to be phone-local
    // only; now it (and any weight/BP the client added) lands in the same
    // daily health snapshot she already sees in health-trends. Never blocks
    // the "Logged" confirmation on network — this is a 10-second quick-log.
    void fetch("/api/app-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: data.token,
        weight_kg: parseFloat(weight) || null,
        bp_systolic: parseInt(bpSys, 10) || null,
        bp_diastolic: parseInt(bpDia, 10) || null,
        mood_score: v,
      }),
    }).catch(() => {});
    setTimeout(() => {
      onClose();
      setTimeout(() => {
        setSaved(false);
        setV(0);
        resetVitals();
      }, 300);
    }, 900);
  };
  return (
    <>
      <div className={"sheet-scrim" + (show ? " show" : "")} onClick={onClose} />
      <div className={"sheet" + (show ? " show" : "")} role="dialog" aria-label="How are you today">
        <div className="grab" />
        {saved ? (
          <div className="center-state" style={{ padding: "24px 24px 30px" }}>
            <span className="ring">
              <Icon name="check" size={28} />
            </span>
            <h3>Logged</h3>
            <p>Thanks — this builds your energy trend over the week.</p>
          </div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            <div className="eyebrow" style={{ paddingLeft: 2 }}>
              Today · {data.today.dateLabel}
            </div>
            <h3 className="h-serif" style={{ fontSize: 21, margin: "8px 0 2px" }}>
              How’s your energy today?
            </h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Ten seconds. It builds the trend you&apos;ll see under Progress.
            </p>
            <div className="dots5" style={{ gap: 12 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={v === n ? "on" : ""} onClick={() => setV(n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className="dots5-cap" style={{ marginBottom: 4 }}>
              <span>Drained</span>
              <span style={{ color: "var(--forest)", fontWeight: 600 }}>{FEEL_WORDS[v]}</span>
              <span>Bright</span>
            </div>

            <button
              type="button"
              onClick={() => setShowVitals((s) => !s)}
              style={{
                background: "none",
                border: "none",
                color: "var(--forest)",
                fontSize: 13,
                fontWeight: 600,
                padding: "12px 0 4px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name={showVitals ? "chevDown" : "plus"} size={13} />
              {showVitals ? "Hide weight / blood pressure" : "Also log your weight or blood pressure"}
            </button>
            {showVitals && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <div style={{ flex: "1 1 0" }}>
                  <VitalInput placeholder="Weight (kg)" value={weight} onChange={setWeight} />
                </div>
                <VitalInput placeholder="Sys" width={64} value={bpSys} onChange={setBpSys} />
                <span style={{ alignSelf: "center", color: "var(--muted)" }}>/</span>
                <VitalInput placeholder="Dia" width={64} value={bpDia} onChange={setBpDia} />
              </div>
            )}

            <button className="submit-btn" disabled={!v} style={{ marginTop: 18 }} onClick={submit}>
              {v ? "Save today’s energy" : "Tap a number"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── manual movement log ──────────────────────────────────────────────────────

const MOVE_TYPES = [
  { key: "walk", label: "Walk", kind: "walk" },
  { key: "yoga", label: "Yoga", kind: "sprout" },
  { key: "breath", label: "Breathwork", kind: "breath" },
  { key: "strength", label: "Strength", kind: "bolt" },
  { key: "other", label: "Other", kind: "heart" },
];
const MOVE_DURS = [10, 15, 20, 30, 45, 60];

export interface MoveEntry {
  id: string;
  label: string;
  kind: string;
  mins: number;
  day: string;
  source: string;
}

export function MoveSheet({
  show,
  onClose,
  onSave,
}: {
  show: boolean;
  onClose: () => void;
  onSave: (m: { label: string; kind: string; mins: number; day: string }) => void;
}) {
  const [type, setType] = useState<(typeof MOVE_TYPES)[number] | null>(null);
  const [mins, setMins] = useState<number | null>(null);
  const [day, setDay] = useState("Today");
  const [saved, setSaved] = useState(false);
  const reset = () => {
    setType(null);
    setMins(null);
    setDay("Today");
  };
  const ready = type && mins;
  const submit = () => {
    if (!type || !mins) return;
    setSaved(true);
    onSave({ label: type.label, kind: type.kind, mins, day });
    setTimeout(() => {
      onClose();
      setTimeout(() => {
        setSaved(false);
        reset();
      }, 300);
    }, 950);
  };
  return (
    <>
      <div className={"sheet-scrim" + (show ? " show" : "")} onClick={onClose} />
      <div className={"sheet" + (show ? " show" : "")} role="dialog" aria-label="Log movement">
        <div className="grab" />
        {saved ? (
          <div className="center-state" style={{ padding: "24px 24px 30px" }}>
            <span className="ring">
              <Icon name="check" size={28} />
            </span>
            <h3>Logged</h3>
            <p>
              Nice — {mins} min of {type?.label.toLowerCase()} added to your week.
            </p>
          </div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            <div className="eyebrow" style={{ paddingLeft: 2 }}>
              Add movement
            </div>
            <h3 className="h-serif" style={{ fontSize: 21, margin: "8px 0 2px" }}>
              What did you do?
            </h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
              Anything counts — a walk, some yoga, a stretch.
            </p>
            <div className="move-types">
              {MOVE_TYPES.map((mt) => (
                <button key={mt.key} className={"move-type" + (type?.key === mt.key ? " on" : "")} onClick={() => setType(mt)}>
                  <Icon name={mt.kind} size={20} />
                  <span>{mt.label}</span>
                </button>
              ))}
            </div>
            <div className="move-q">How long?</div>
            <div className="dur-chips">
              {MOVE_DURS.map((d) => (
                <button key={d} className={"dur-chip" + (mins === d ? " on" : "")} onClick={() => setMins(d)}>
                  {d}
                  <small>min</small>
                </button>
              ))}
            </div>
            <div className="move-q">When?</div>
            <div className="when-toggle">
              {["Today", "Yesterday"].map((w) => (
                <button key={w} className={day === w ? "on" : ""} onClick={() => setDay(w)}>
                  {w}
                </button>
              ))}
            </div>
            <button className="submit-btn" disabled={!ready} style={{ marginTop: 20 }} onClick={submit}>
              {ready ? `Add ${mins} min of ${type!.label.toLowerCase()}` : "Pick a type and length"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
