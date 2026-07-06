"use client";

/**
 * Progress screen — symptom-score hero (built from real check-ins),
 * watch list, lab checkpoints, daily feeling strip, movement, journey.
 */

import { useEffect, useState } from "react";
import { Icon, useOchre } from "./ochre-context";
import { MiniRating, ProgressArc, Section } from "./ochre-ui";
import type { MoveEntry } from "./ochre-checkin";
import type { JourneyItem } from "@/lib/fmdb/client-app";
import { MsqCard } from "./ochre-msq";
import { GrowingTree } from "./growing-tree";
import { isGrowingTreeEnabled } from "./growing-tree-flag";

// ── symptom-score hero ───────────────────────────────────────────────────────

function SymptomHero() {
  const { symptomScore: S } = useOchre();
  const [grow, setGrow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrow(true), 160);
    return () => clearTimeout(t);
  }, []);
  if (!S) return null;
  const W = 300,
    H = 132,
    padL = 14,
    padR = 14,
    padT = 14,
    padB = 26;
  const vmax = 100,
    vmin = 20;
  const good = S.goodAt;
  const xs = S.points.map((_, i) => padL + (i / Math.max(S.points.length - 1, 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - vmin) / (vmax - vmin)) * (H - padT - padB);
  const line = S.points.map((p, i) => `${i ? "L" : "M"} ${xs[i].toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L ${xs[xs.length - 1].toFixed(1)} ${H - padB} L ${xs[0].toFixed(1)} ${H - padB} Z`;
  const yGood = y(good);
  const last = S.points[S.points.length - 1];
  const first = S.points[0];
  // Direction reflects the ACTUAL trend (higher wellbeing = better) — never a
  // hardcoded ↑, which showed "improving" even when the score fell.
  const trend = S.points.length < 2 ? 0 : Math.sign(last.v - first.v);
  return (
    <div className="lab-hero">
      <div className="lh-top">
        <div>
          <div className="lh-name">
            Wellbeing score <span className="lh-unit">/ 100</span>
          </div>
          <div className="lh-val">
            {last.v}
            {S.points.length >= 2 && (
              <span className="lh-arrow" aria-hidden>
                {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"}
              </span>
            )}
          </div>
        </div>
        <span className="lh-trend">{S.deltaLabel}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="lh-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lhFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--forest)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--forest)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y={padT} width={W} height={Math.max(yGood - padT, 0)} fill="var(--forest-tint)" />
        <line x1="0" y1={yGood} x2={W} y2={yGood} stroke="var(--forest)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        <text x={W - padR} y={yGood - 5} textAnchor="end" fontSize="9.5" fill="var(--forest)" opacity="0.8">
          steady ≥ {good}
        </text>
        <path d={area} fill="url(#lhFill)" opacity={grow ? 1 : 0} style={{ transition: "opacity .8s ease" }} />
        <path
          d={line}
          fill="none"
          stroke="var(--forest)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={grow ? 0 : 1}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.3,.7,.3,1)" }}
        />
        {S.points.map((p, i) => (
          <g key={i} opacity={grow ? 1 : 0} style={{ transition: `opacity .5s ease ${0.5 + i * 0.08}s` }}>
            <circle
              cx={xs[i]}
              cy={y(p.v)}
              r={i === S.points.length - 1 ? 5 : 3}
              fill={i === S.points.length - 1 ? "var(--forest)" : "var(--paper)"}
              stroke="var(--forest)"
              strokeWidth="2"
            />
            <text x={xs[i]} y={H - 9} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
              wk {p.wk}
            </text>
          </g>
        ))}
      </svg>
      <div className="lh-cap">{S.caption}</div>
      <div className="lh-next">
        <Icon name="clock" size={13} /> {S.next}
      </div>
    </div>
  );
}

function SymptomHeroEmpty({ goCheckin }: { goCheckin: () => void }) {
  return (
    <div className="hero-empty">
      <span className="he-ico">
        <Icon name="progress" size={24} />
      </span>
      <h3>Your trend starts here</h3>
      <p>Each weekly check-in adds a point to your wellbeing trend — how you feel is the proof of progress, no blood draws needed.</p>
      <button className="feel-cta" style={{ marginTop: 14 }} onClick={goCheckin}>
        <Icon name="checkin" size={16} /> Do this week’s check-in
      </button>
    </div>
  );
}

function LabCheckpoints() {
  const { labCheckpoints: C } = useOchre();
  return (
    <div className="card lab-ck">
      <div className="lab-ck-head">
        <Icon name="droplet" size={15} style={{ color: "var(--ochre)" }} />
        <span>Lab checkpoints</span>
      </div>
      <div className="lab-ck-track">
        {C.list.map((c, i) => (
          <div className={"lab-ck-step " + c.state} key={i}>
            <span className="lck-dot">{c.state === "done" && <Icon name="check" size={11} />}</span>
            <div className="lck-label">{c.label}</div>
            <div className="lck-sub">{c.sub}</div>
            <div className="lck-val">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="lab-ck-note">{C.note}</div>
    </div>
  );
}

// ── daily feeling strip ──────────────────────────────────────────────────────

export interface FeelMap {
  [isoDate: string]: number;
}

function FeelStrip({ feel, onLogToday }: { feel: FeelMap; onLogToday: () => void }) {
  // last 14 days from the locally-saved map
  const days: { d: string; v: number | null }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    days.push({ d: String(d.getDate()), v: feel[iso] ?? null });
  }
  const logged = days.filter((x) => x.v != null) as { d: string; v: number }[];
  const avg = logged.length ? logged.reduce((a, x) => a + x.v, 0) / logged.length : 0;
  return (
    <div className="feel-card">
      <div className="feel-head">
        <div>
          <div className="feel-label">Energy, last 2 weeks</div>
          <div className="feel-avg">
            {logged.length ? (
              <>
                Averaging <strong>{avg.toFixed(1)}</strong> / 5 from {logged.length} {logged.length === 1 ? "day" : "days"}
              </>
            ) : (
              "Log your first day below — ten seconds."
            )}
          </div>
        </div>
      </div>
      <div className="feel-bars">
        {days.map((d, i) => (
          <div key={i} className="feel-col">
            <div className="feel-track">
              {d.v == null ? (
                <div className="feel-bar empty" />
              ) : (
                <div className="feel-bar" style={{ height: `${(d.v / 5) * 100}%`, opacity: 0.45 + (d.v / 5) * 0.55 }} />
              )}
            </div>
            <div className="feel-d">{d.d}</div>
          </div>
        ))}
      </div>
      <button className="feel-cta" onClick={onLogToday}>
        <Icon name="plus" size={16} /> How’s your energy today?
      </button>
    </div>
  );
}

// ── vitals (weight + blood pressure, self-logged from the energy sheet) ────

function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function VitalsCard({ onLog }: { onLog: () => void }) {
  const { body } = useOchre();
  const hist = body.history;
  const weightPts = hist.filter((h) => h.weightKg != null) as { date: string; weightKg: number }[];
  const bpPts = hist.filter((h) => h.bpSystolic != null && h.bpDiastolic != null) as {
    date: string;
    bpSystolic: number;
    bpDiastolic: number;
  }[];
  const latestWeight = weightPts[weightPts.length - 1];
  const latestBp = bpPts[bpPts.length - 1];
  const weightDelta =
    weightPts.length >= 2 ? Math.round((latestWeight.weightKg - weightPts[0].weightKg) * 10) / 10 : null;

  if (!latestWeight && !latestBp) {
    return (
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
          Log your weight or blood pressure any time — daily, weekly, whatever suits you. It builds a trend here.
        </div>
        <button className="feel-cta" onClick={onLog}>
          <Icon name="plus" size={16} /> Log your vitals
        </button>
      </div>
    );
  }

  const W = 260,
    H = 52,
    padX = 6,
    padY = 8;
  const vals = weightPts.map((p) => p.weightKg);
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const span = hi - lo || 1;
  const vmin = lo - span * 0.15,
    vmax = hi + span * 0.15;
  const xs = weightPts.map((_, i) => padX + (i / Math.max(weightPts.length - 1, 1)) * (W - padX * 2));
  const y = (val: number) => padY + (1 - (val - vmin) / (vmax - vmin)) * (H - padY * 2);
  const line = weightPts.map((p, i) => `${i ? "L" : "M"} ${xs[i].toFixed(1)} ${y(p.weightKg).toFixed(1)}`).join(" ");

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 22 }}>
        {latestWeight && (
          <div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>
              Weight
            </div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink)" }}>
              {latestWeight.weightKg}
              <span style={{ fontSize: 12, color: "var(--muted)" }}> kg</span>
            </div>
            {weightDelta != null && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: weightDelta < 0 ? "var(--forest)" : weightDelta > 0 ? "var(--ochre)" : "var(--muted)",
                }}
              >
                {weightDelta === 0 ? "steady" : `${weightDelta > 0 ? "+" : ""}${weightDelta} kg since you started`}
              </div>
            )}
          </div>
        )}
        {latestBp && (
          <div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>
              Blood pressure
            </div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink)" }}>
              {latestBp.bpSystolic}/{latestBp.bpDiastolic}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{fmtShort(latestBp.date)}</div>
          </div>
        )}
      </div>
      {weightPts.length >= 2 && (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
          <path d={line} fill="none" stroke="var(--forest)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={xs[xs.length - 1]} cy={y(weightPts[weightPts.length - 1].weightKg)} r={3.4} fill="var(--forest)" />
        </svg>
      )}
      <button
        onClick={onLog}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 12px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--paper)",
          color: "var(--forest-deep)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <Icon name="plus" size={13} /> Log today
      </button>
    </div>
  );
}

// ── movement ─────────────────────────────────────────────────────────────────

function MovementCard({ sessions, onAdd }: { sessions: MoveEntry[]; onAdd: () => void }) {
  const { movementGoalMins } = useOchre();
  const minutes = sessions.reduce((s, m) => s + (m.mins || 0), 0);
  const count = sessions.length;
  const r = 26,
    c = 32,
    circ = 2 * Math.PI * r;
  const pct = Math.min(minutes / movementGoalMins, 1);
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash(circ * pct), 160);
    return () => clearTimeout(t);
  }, [pct, circ]);
  return (
    <div className="card move-card">
      <div className="move-top">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="var(--ochre)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - dash}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: "stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1)" }}
          />
          <text x={c} y={c - 1} textAnchor="middle" dominantBaseline="middle" fontFamily="Georgia, serif" fontSize="17" fill="var(--ink)">
            {minutes}
          </text>
          <text x={c} y={c + 13} textAnchor="middle" dominantBaseline="middle" fontSize="8.5" fill="var(--muted)">
            min
          </text>
        </svg>
        <div className="move-stat">
          <div className="ms-1">
            {count} {count === 1 ? "session" : "sessions"} this week
          </div>
          <div className="ms-2">
            {minutes} of {movementGoalMins} min · {Math.round(pct * 100)}% of goal
          </div>
        </div>
        <button className="move-add" onClick={onAdd} aria-label="Log movement">
          <Icon name="plus" size={16} />
          <span>Log</span>
        </button>
      </div>
      {sessions.length > 0 && (
        <div className="move-list">
          {sessions.map((m) => (
            <div className="move-row" key={m.id}>
              <span className="move-ico">
                <Icon name={m.kind} size={16} />
              </span>
              <span className="move-name">{m.label}</span>
              <span className="move-src self">You</span>
              <span className="move-meta">
                {m.mins} min · {m.day}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── journey ──────────────────────────────────────────────────────────────────

function JourneyNode({ item, open, onToggle }: { item: JourneyItem & { future?: boolean }; open: boolean; onToggle: () => void }) {
  const cls = item.kind === "start" ? "start" : item.future ? "future" : "";
  return (
    <div className={"tl-node " + cls}>
      <span className="pin" />
      <div className={"tl-card" + (item.future ? " future" : "")}>
        <button className="tl-head" onClick={onToggle} aria-expanded={open}>
          <div style={{ flex: 1 }}>
            <div className="wk">{item.kind === "start" ? "Start" : item.kind === "update" ? "Plan update" : "Check-in"}</div>
            <div className="ti">{item.title}</div>
            <div className="when">{item.when}</div>
          </div>
          {item.kind === "checkin" && typeof (item as { rating?: number }).rating === "number" && (
            <MiniRating value={(item as { rating?: number }).rating ?? 0} />
          )}
          <span className="chev" style={{ transition: "transform .28s", transform: open ? "rotate(90deg)" : "none" }}>
            <Icon name="chev" size={18} />
          </span>
        </button>
        <div className={"tl-body" + (open ? " open" : "")}>
          <div>
            <div className="pad">
              {item.summary && (
                <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--muted)", fontSize: 14, lineHeight: 1.55 }}>
                  {item.summary}
                </div>
              )}
              {item.note && (
                <div className="coach-note">
                  <div className="cn-who">
                    <Icon name="leaf" size={14} /> {item.note.who}
                  </div>
                  <div className="cn-text">{item.note.text}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProgressScreen({
  goCheckin,
  onLogFeeling,
  feel,
  moves,
  onLogMove,
  openMsq,
  dailyDone,
  dailyTotal,
  streak,
  bonusBlossoms,
  bonusFruit,
}: {
  goCheckin: () => void;
  onLogFeeling: () => void;
  feel: FeelMap;
  moves: MoveEntry[];
  onLogMove: () => void;
  openMsq: () => void;
  dailyDone: number;
  dailyTotal: number;
  streak: number;
  bonusBlossoms: number;
  bonusFruit: number;
}) {
  const data = useOchre();
  const [open, setOpen] = useState(-2);
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting" style={{ paddingBottom: 4 }}>
        <div className="hi" style={{ fontSize: 24 }}>
          Your progress
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {data.client.notStarted
            ? data.client.startsInDays > 0
              ? `Your journey begins in ${data.client.startsInDays} day${data.client.startsInDays === 1 ? "" : "s"} — this is a preview.`
              : "Your journey is being set up — progress starts tracking once week 1 begins."
            : `Week ${data.client.week} of ${data.client.totalWeeks} — here’s how it’s going.`}
        </div>
      </div>

      {isGrowingTreeEnabled(data.clientId) && (
        <div className="rn-tree-hero" style={{ marginTop: 6, marginBottom: 2 }}>
          <GrowingTree
            week={data.client.week}
            totalWeeks={data.client.totalWeeks}
            dailyDone={dailyDone}
            dailyTotal={dailyTotal}
            streak={streak}
            bonusBlossoms={bonusBlossoms}
            bonusFruit={bonusFruit}
          />
          {streak >= 3 && (
            <div className="rn-tree-streak">🔥 {streak}-day streak — keep it alive</div>
          )}
          <p className="rn-tree-note">
            This is your tree — it grows with you. Every week it gets a little taller, and each
            supplement, habit, and check-in you log fills it with leaves. Reach a milestone and it
            blossoms and fruits. Show up a little each day and watch it flourish.
          </p>
          {data.client.startsInDays > 0 ? (
            <div className="rn-tree-nudge">🌱 It wakes up on {data.client.startDateLabel} — that&rsquo;s your Day 1.</div>
          ) : dailyTotal > 0 && dailyDone < dailyTotal ? (
            <div className="rn-tree-nudge">🌿 {dailyTotal - dailyDone} more to log today — each one grows a new leaf.</div>
          ) : dailyTotal > 0 ? (
            <div className="rn-tree-nudge">🎉 All logged today — your tree just grew. See you tomorrow!</div>
          ) : null}
        </div>
      )}

      {/* No fabricated progress before the plan starts: the arc claimed "Week 1
          / ~8%" on a preview. Show it only once the journey is actually under way. */}
      {!data.client.notStarted && (
        <div className="card" style={{ padding: "14px 0 6px", marginTop: 12 }}>
          <ProgressArc week={data.client.week} total={data.client.totalWeeks} />
        </div>
      )}

      <Section title="Is it working?">
        {/* MSQ — the FM-standard symptom score; baseline → falling trend */}
        <div style={{ marginBottom: 12 }}>
          <MsqCard openMsq={openMsq} />
        </div>
        {data.symptomScore ? <SymptomHero /> : <SymptomHeroEmpty goCheckin={goCheckin} />}
        {data.watchList.length > 0 && (
          <>
            <div className="card" style={{ overflow: "hidden", marginTop: 12 }}>
              {data.watchList.map((l, i) => (
                <div className="trend-row" key={i}>
                  <span className="tr-name">{l.name}</span>
                  <span className="tr-note">{l.note}</span>
                </div>
              ))}
            </div>
            <div className="watch-note" style={{ marginTop: 8 }}>
              The shifts {data.coach.name.split(" ")[0]} asked you to notice — they roll into your weekly check-in.
            </div>
          </>
        )}
        <LabCheckpoints />
      </Section>

      <Section title="How you’re feeling">
        <FeelStrip feel={feel} onLogToday={onLogFeeling} />
      </Section>

      <Section title="Your vitals">
        <VitalsCard onLog={onLogFeeling} />
      </Section>

      <Section title="Movement">
        <MovementCard sessions={moves} onAdd={onLogMove} />
        <div className="card-quiet soon" style={{ marginTop: 10 }}>
          <Icon name="walk" size={16} style={{ color: "var(--ochre)" }} />
          <span>
            Tap <strong>Log</strong> to add a walk or session — anything counts, and it stays on your phone.
          </span>
        </div>
      </Section>

      <Section title="Your journey">
        <div className="tl" style={{ marginTop: 4 }}>
          <JourneyNode
            item={{
              kind: "checkin",
              week: data.client.week,
              title: "This week’s check-in",
              when: "Open any time",
              future: true,
              summary: `Your week ${data.client.week} reflection will appear here once you check in.`,
            }}
            open={open === -1}
            onToggle={() => setOpen(open === -1 ? -2 : -1)}
          />
          {data.journey.map((it, i) => (
            <JourneyNode key={i} item={it} open={open === i} onToggle={() => setOpen(open === i ? -2 : i)} />
          ))}
        </div>
      </Section>
    </div>
  );
}
