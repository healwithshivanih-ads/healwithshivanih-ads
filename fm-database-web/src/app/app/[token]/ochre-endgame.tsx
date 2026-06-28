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
