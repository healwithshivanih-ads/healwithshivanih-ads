"use client";

/* ======================================================================
   The Ochre Tree — MSQ symptom check (the FM-standard outcome score)
   ----------------------------------------------------------------------
   A guided, category-by-category questionnaire (15 short steps). Every
   symptom starts at "Never" — the client only taps the ones they have,
   so a baseline takes ~3-5 minutes. Totals are recomputed server-side;
   the falling score over the programme is the single most motivating
   graph a client can see.

   Draft persists locally so a half-done check survives an interruption.
   Cadence: first check any time, retakes unlock 21 days after the last.
   ====================================================================== */

import { useEffect, useMemo, useState } from "react";
import { MSQ_CATEGORIES, MSQ_SCALE, msqBand, msqTotal, msqKey, type MsqAnswers } from "@/lib/fmdb/msq";
import { Icon, useOchre } from "./ochre-context";

const RETAKE_DAYS = 21;

/* ---- Progress tab card ------------------------------------------------ */

export function MsqCard({ openMsq }: { openMsq: () => void }) {
  const data = useOchre();
  const entries = data.msqEntries;
  const latest = entries[entries.length - 1];
  const prev = entries[entries.length - 2];

  if (!latest) {
    return (
      <button className="msq-cta" onClick={openMsq}>
        <span className="msq-cta-ico" aria-hidden="true">
          <Icon name="checkin" size={20} />
        </span>
        <span className="msq-cta-body">
          <span className="msq-cta-title">Your symptom baseline</span>
          <span className="msq-cta-meta">
            5 minutes, once — then a quick retake every few weeks, so your progress shows up as a falling number.
          </span>
        </span>
        <span className="chev">
          <Icon name="chev" size={18} />
        </span>
      </button>
    );
  }

  const band = msqBand(latest.total);
  const delta = prev ? latest.total - prev.total : null;
  const daysSince = Math.floor((Date.now() - new Date(`${latest.date}T00:00:00Z`).getTime()) / 86_400_000);
  const canRetake = daysSince >= RETAKE_DAYS;

  // sparkline over all entries
  const max = Math.max(...entries.map((e) => e.total), 10);
  const W = 220;
  const H = 44;
  const pts = entries
    .map((e, i) => {
      const x = entries.length === 1 ? W / 2 : (i / (entries.length - 1)) * (W - 8) + 4;
      const y = H - 6 - (e.total / max) * (H - 12);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="card msq-card">
      <div className="msq-top">
        <div>
          <div className="msq-score">{latest.total}</div>
          <div className={"msq-band b-" + band.id}>{band.label}</div>
        </div>
        {delta !== null && (
          <div className={"msq-delta " + (delta < 0 ? "good" : delta > 0 ? "bad" : "")}>
            {delta < 0 ? "▼" : delta > 0 ? "▲" : "→"} {Math.abs(delta)}
            <small>since last check</small>
          </div>
        )}
        {entries.length >= 2 && (
          <svg width={W} height={H} className="msq-spark" aria-hidden="true">
            <polyline points={pts} fill="none" stroke="var(--forest)" strokeWidth="2" strokeLinecap="round" />
            {entries.map((e, i) => {
              const x = (i / (entries.length - 1)) * (W - 8) + 4;
              const y = H - 6 - (e.total / max) * (H - 12);
              return <circle key={i} cx={x} cy={y} r="3" fill="var(--forest)" />;
            })}
          </svg>
        )}
      </div>
      <div className="msq-note">{band.note}</div>
      <div className="msq-foot">
        {canRetake ? (
          <button className="msq-retake" onClick={openMsq}>
            <Icon name="checkin" size={14} /> Retake your symptom check
          </button>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Next check unlocks in {RETAKE_DAYS - daysSince} day{RETAKE_DAYS - daysSince === 1 ? "" : "s"} — scores
            need a few weeks to move.
          </span>
        )}
      </div>
    </div>
  );
}

/* ---- the questionnaire overlay ---------------------------------------- */

type Status = "intro" | "running" | "saving" | "done" | "error";

export function MsqOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const DRAFT = `ochre.msq.draft.${data.clientId}`;
  const [status, setStatus] = useState<Status>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<MsqAnswers>({});
  const [result, setResult] = useState<{ total: number } | null>(null);
  const [error, setError] = useState("");

  // restore a half-done draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) {
        const d = JSON.parse(raw) as { answers: MsqAnswers; step: number };
        if (d && d.answers && Object.keys(d.answers).length > 0) {
          setAnswers(d.answers);
          setStep(Math.min(d.step ?? 0, MSQ_CATEGORIES.length - 1));
        }
      }
    } catch {
      /* fresh */
    }
  }, [DRAFT]);

  const saveDraft = (a: MsqAnswers, st: number) => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ answers: a, step: st }));
    } catch {
      /* private mode */
    }
  };

  const cat = MSQ_CATEGORIES[step];
  const setAnswer = (key: string, v: number) => {
    const next = { ...answers, [key]: v };
    setAnswers(next);
    saveDraft(next, step);
  };

  const runningTotal = useMemo(() => msqTotal(answers), [answers]);

  const submit = async () => {
    setStatus("saving");
    setError("");
    // every un-tapped symptom is an explicit 0 ("never")
    const full: MsqAnswers = {};
    for (const c of MSQ_CATEGORIES)
      c.items.forEach((_, i) => {
        const k = msqKey(c.id, i);
        full[k] = answers[k] ?? 0;
      });
    try {
      const res = await fetch("/api/app-msq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, week: data.client.week, answers: full }),
      });
      const out = (await res.json()) as { ok?: boolean; total?: number; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error || "save failed");
      try {
        localStorage.removeItem(DRAFT);
      } catch {
        /* fine */
      }
      setResult({ total: out.total ?? runningTotal });
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save — try again.");
      setStatus("error");
    }
  };

  /* ---- done ---- */
  if (status === "done" && result) {
    const band = msqBand(result.total);
    const prev = data.msqEntries[data.msqEntries.length - 1];
    const delta = prev ? result.total - prev.total : null;
    return (
      <div className="overlay-scroll">
        <div className="overlay-pad msq-done">
          <div className="msq-done-ring">
            <span className="msq-done-score">{result.total}</span>
          </div>
          <div className={"msq-band b-" + band.id} style={{ margin: "10px auto 0" }}>
            {band.label}
          </div>
          <h2 className="h-serif" style={{ fontSize: 22, margin: "14px 0 6px" }}>
            {delta !== null && delta < 0
              ? `Down ${Math.abs(delta)} since your last check 🎉`
              : "Your baseline is recorded"}
          </h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
            {band.note} {data.coach.name.split(" ")[0]} sees this too and will bring it to your next session.
          </p>
          <button
            className="wa-btn"
            style={{ width: "auto", padding: "13px 26px", margin: "20px auto 0" }}
            onClick={() => window.location.reload()}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  /* ---- intro ---- */
  if (status === "intro" && Object.keys(answers).length === 0) {
    return (
      <div className="overlay-scroll">
        <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
          <Icon name="arrowLeft" size={18} /> Back
        </button>
        <div className="overlay-pad">
          <div className="eyebrow">Symptom check · about 5 minutes</div>
          <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
            How has your body felt these last 2 weeks?
          </h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 10 }}>
            {MSQ_CATEGORIES.length} quick screens, one body area each. Everything starts at
            “never” — only tap the symptoms you actually have. Your score becomes the line we
            watch fall over your programme.
          </p>
          <button className="msq-begin" onClick={() => setStatus("running")}>
            Begin
          </button>
        </div>
      </div>
    );
  }

  /* ---- running ---- */
  const last = step === MSQ_CATEGORIES.length - 1;
  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Save &amp; close
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <div className="eyebrow">
          {step + 1} of {MSQ_CATEGORIES.length} · score so far {runningTotal}
        </div>
        <div className="msq-progress">
          <span style={{ width: `${((step + 1) / MSQ_CATEGORIES.length) * 100}%` }} />
        </div>
        <h2 className="h-serif" style={{ fontSize: 23, margin: "12px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={cat.glyph} size={20} style={{ color: "var(--ochre)" }} /> {cat.label}
        </h2>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Over the last 2 weeks…
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {cat.items.map((item, i) => {
            const k = msqKey(cat.id, i);
            const v = answers[k] ?? 0;
            return (
              <div key={k} className="msq-item">
                <div className={"msq-item-name" + (v > 0 ? " on" : "")}>{item}</div>
                <div className="msq-chips">
                  {MSQ_SCALE.map((s) => (
                    <button
                      key={s.value}
                      className={"msq-chip" + (v === s.value ? " on" : "") + (s.value >= 2 && v === s.value ? " hot" : "")}
                      onClick={() => setAnswer(k, s.value)}
                      aria-pressed={v === s.value}
                      title={s.label}
                    >
                      {s.value === 0 ? "—" : s.value}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          — never · 1 sometimes, mild · 2 sometimes, severe · 3 often, mild · 4 often, severe
        </div>

        {status === "error" && (
          <div style={{ color: "#a23b3b", fontSize: 12.5, marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          {step > 0 && (
            <button
              className="msq-nav ghost"
              onClick={() => {
                setStep(step - 1);
                saveDraft(answers, step - 1);
              }}
            >
              Back
            </button>
          )}
          <button
            className="msq-nav primary"
            disabled={status === "saving"}
            onClick={() => {
              if (last) void submit();
              else {
                setStep(step + 1);
                saveDraft(answers, step + 1);
                document.querySelector(".ochre-app .overlay-scroll")?.scrollTo({ top: 0 });
              }
            }}
          >
            {status === "saving" ? "Saving…" : last ? "Finish & see my score" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
