"use client";

/**
 * End-game surfaces — the graduation → maintenance → library-floor experience.
 * Driven by data.mode / data.endgame (resolved in app-mode.ts + client-app.ts).
 *
 * EndgameBanner    — a slim state card for REVIEW / MAINTENANCE / GRACE. The
 *                    active app stays fully usable; the banner surfaces the
 *                    decision/state and a one-tap way to talk to the coach.
 * LibraryFloorScreen — the frozen floor shown as the home when the programme
 *                    has fully completed (LIBRARY). Never a lock-out: recipes +
 *                    guides stay open, with a gentle re-engage path.
 */

import { useOchre } from "./ochre-context";

const FOREST = "var(--forest, #2d5a3d)";
const OCHRE = "var(--ochre, #b07b1e)";
const INK = "var(--ink, #2c2a24)";
const MUTED = "var(--muted, #6f6a5d)";
const LINE = "var(--line, #e6e1d6)";

const cardStyle: React.CSSProperties = {
  background: "var(--bg, #fff)",
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  padding: "13px 15px",
  marginBottom: 12,
};

function CtaButton({ label, onClick, tone = FOREST }: { label: string; onClick: () => void; tone?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 10,
        width: "100%",
        padding: "11px 16px",
        borderRadius: 11,
        border: "none",
        background: tone,
        color: "#fff",
        fontSize: 14,
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function EndgameBanner({ goCoach }: { goCoach: () => void }) {
  const { endgame } = useOchre();
  // LIBRARY has its own full screen; ACTIVE has no banner.
  if (!endgame || endgame.mode === "LIBRARY") return null;

  let tint = "rgba(45,90,61,0.09)";
  let border = "rgba(45,90,61,0.20)";
  let fg = FOREST;
  let title = "";
  let body = "";
  let cta: string | null = null;

  if (endgame.mode === "REVIEW") {
    title = "Your 12 weeks are wrapping up";
    body = endgame.recheckLabel
      ? `You reach your recheck point around ${endgame.recheckLabel}. Let's choose what's next — a fresh phase, or a lighter maintenance plan.`
      : "Let's choose what's next — a fresh phase, or a lighter maintenance plan.";
    cta = "Plan what's next";
  } else if (endgame.mode === "GRACE") {
    tint = "rgba(176,123,30,0.10)";
    border = "rgba(176,123,30,0.28)";
    fg = OCHRE;
    title = "Let's keep your momentum";
    body = endgame.graceUntilLabel
      ? `Your maintenance has paused — you still have full access until ${endgame.graceUntilLabel}. Renew anytime to keep everything unlocked.`
      : "Your maintenance has paused — renew anytime to keep everything unlocked.";
    cta = "Renew maintenance";
  } else {
    // MAINTENANCE — calm, informational, no hard CTA.
    title = "You're on maintenance";
    body = endgame.paidThroughLabel
      ? `Lighter touch, same support — your maintenance runs through ${endgame.paidThroughLabel}.`
      : "Lighter touch, same support.";
    cta = null;
  }

  return (
    <div
      style={{
        margin: "10px 12px 0",
        padding: "12px 14px",
        borderRadius: 13,
        background: tint,
        border: `1px solid ${border}`,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: fg }}>
        <span aria-hidden="true" style={{ marginRight: 6 }}>✦</span>
        {title}
      </div>
      <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginTop: 4 }}>{body}</div>
      {cta && <CtaButton label={cta} onClick={goCoach} tone={fg} />}
    </div>
  );
}

function ProgressStat({ label, from, to, better }: { label: string; from: string; to: string; better: string | null }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 5 }}>
        <span style={{ fontSize: 15, color: MUTED }}>{from}</span>
        <span aria-hidden="true" style={{ color: MUTED, fontSize: 14 }}>→</span>
        <span style={{ fontSize: 22, fontWeight: 500, color: FOREST }}>{to}</span>
      </div>
      {better && <div style={{ fontSize: 12.5, color: FOREST, marginTop: 3 }}>{better}</div>}
    </div>
  );
}

function ChoiceCard({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "var(--bg, #fff)",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>{title}</span>
        <span aria-hidden="true" style={{ color: FOREST, fontSize: 16 }}>→</span>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.45, marginTop: 3 }}>{sub}</div>
    </button>
  );
}

/** REVIEW — the graduation report. Celebrates the 12-week journey in real deltas
 *  (wellbeing score, MSQ symptom load, weight, waist) and offers the two next
 *  tracks. onContinue / onMaintain are wired to the in-app checkout (or the coach
 *  as a fallback). */
export function GraduationReport({ onContinue, onMaintain }: { onContinue: () => void; onMaintain: () => void }) {
  const data = useOchre();
  const { client, coach } = data;

  const stats: { label: string; from: string; to: string; better: string | null }[] = [];
  const ss = data.symptomScore;
  if (ss && ss.points.length >= 2) {
    stats.push({
      label: "Wellbeing score",
      from: `${ss.points[0].v}`,
      to: `${ss.points[ss.points.length - 1].v}`,
      better: ss.deltaLabel || null,
    });
  }
  const msq = data.msqEntries ?? [];
  if (msq.length >= 2) {
    const b = msq[0];
    const l = msq[msq.length - 1];
    const dropped = b.total - l.total;
    const bandChg = b.band !== l.band ? `${b.band} → ${l.band}` : "";
    stats.push({
      label: "Symptom load (MSQ)",
      from: `${b.total}`,
      to: `${l.total}`,
      better: dropped > 0 ? `Down ${dropped} point${dropped === 1 ? "" : "s"}${bandChg ? ` · ${bandChg}` : ""}` : bandChg || null,
    });
  }
  const bh = data.body?.history ?? [];
  const fW = bh.find((h) => h.weightKg != null);
  const lW = [...bh].reverse().find((h) => h.weightKg != null);
  if (fW && lW && fW !== lW && fW.weightKg != null && lW.weightKg != null && fW.weightKg !== lW.weightKg) {
    const d = Math.round((lW.weightKg - fW.weightKg) * 10) / 10;
    stats.push({ label: "Weight", from: `${fW.weightKg} kg`, to: `${lW.weightKg} kg`, better: `${d > 0 ? "+" : ""}${d} kg` });
  }
  const fA = bh.find((h) => h.waistCm != null);
  const lA = [...bh].reverse().find((h) => h.waistCm != null);
  if (fA && lA && fA !== lA && fA.waistCm != null && lA.waistCm != null && fA.waistCm !== lA.waistCm) {
    const d = Math.round((lA.waistCm - fA.waistCm) * 10) / 10;
    stats.push({ label: "Waist", from: `${fA.waistCm} cm`, to: `${lA.waistCm} cm`, better: `${d > 0 ? "+" : ""}${d} cm` });
  }

  return (
    <div style={{ padding: "8px 14px 24px" }}>
      <div style={{ textAlign: "center", padding: "18px 8px 10px" }}>
        <div aria-hidden="true" style={{ fontSize: 26, color: FOREST }}>✦</div>
        <h2 style={{ fontSize: 19, color: INK, margin: "9px 0 6px", fontWeight: 500 }}>
          You&apos;ve reached the finish line, {client.firstName}
        </h2>
        <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, margin: 0 }}>
          {stats.length > 0
            ? "Look how far you've come — your journey in numbers."
            : "You've completed your plan. Let's choose what comes next."}
        </p>
      </div>

      {stats.map((s) => (
        <ProgressStat key={s.label} {...s} />
      ))}

      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: INK }}>What&apos;s next?</div>
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "5px 0 11px" }}>
          Two ways to keep your momentum — {coach.name} tailors either to where you are now.
        </p>
        <ChoiceCard title="Continue" sub="A fresh phase — keep building on what's working." onClick={onContinue} />
        <ChoiceCard title="Maintain" sub="A lighter plan to hold your gains, with regular check-ins." onClick={onMaintain} />
      </div>
    </div>
  );
}

export function LibraryFloorScreen({ goCoach, goTab }: { goCoach: () => void; goTab: (t: string) => void }) {
  const { endgame, client, coach } = useOchre();
  const bot = endgame?.backOnTrack ?? null;

  return (
    <div style={{ padding: "8px 14px 24px" }}>
      <div style={{ textAlign: "center", padding: "20px 8px 10px" }}>
        <div aria-hidden="true" style={{ fontSize: 28, color: FOREST }}>✦</div>
        <h2 style={{ fontSize: 19, color: INK, margin: "10px 0 6px", fontWeight: 500 }}>
          Your programme is complete
        </h2>
        <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, margin: 0 }}>
          Well done, {client.firstName}. Your journey is complete — and everything you built stays right here for you.
        </p>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>Your library stays open</div>
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 0" }}>
          Your recipes, meal guides and remedies don&apos;t expire — revisit them whenever you like.
        </p>
        <CtaButton label="Browse my plan + recipes" onClick={() => goTab("plan")} />
      </div>

      {bot && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: FOREST }}>{bot.title}</div>
          {bot.intro && (
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 8px" }}>{bot.intro}</p>
          )}
          {bot.steps.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: INK, lineHeight: 1.6 }}>
              {bot.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>Ready for the next chapter?</div>
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 0" }}>
          Whether it&apos;s a new focus or a lighter maintenance plan, {coach.name} is one message away.
        </p>
        <CtaButton label={`Talk to ${coach.name}`} onClick={goCoach} />
      </div>
    </div>
  );
}
