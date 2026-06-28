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

import { useState } from "react";
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

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Maintenance / renewal checkout overlay. One-time Razorpay payment (NOT
 * auto-debit) for a fixed-price block of months; the verified webhook flips the
 * order to paid + extends the client's coverage. Amount is server-fixed — this UI
 * only picks the term. On a successful Checkout handler it shows a "processing"
 * state (the webhook is the source of truth; coverage extends on next app load).
 */
export function MaintenanceCheckout({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const pricing = data.endgame?.pricing ?? [];
  const [term, setTerm] = useState<number>(pricing[0]?.termMonths ?? 6);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const selected = pricing.find((p) => p.termMonths === term) ?? pricing[0] ?? null;

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/maintenance/${data.clientId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termMonths: term }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        razorpay_order_id?: string;
        amount_inr?: number;
        currency?: string;
        keyId?: string;
      };
      if (!j.ok) throw new Error(j.error || "could not start payment");
      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error("payment is unavailable right now");
      const rzp = new window.Razorpay({
        key: j.keyId,
        order_id: j.razorpay_order_id,
        amount: (j.amount_inr ?? selected?.inr ?? 0) * 100,
        currency: j.currency ?? "INR",
        name: "The Ochre Tree",
        description: `Maintenance — ${term} month${term === 1 ? "" : "s"}`,
        theme: { color: "#2d5a3d" },
        handler: () => setDone(true), // webhook is the source of truth
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(20,18,14,0.42)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--bg, #fff)",
          borderRadius: "18px 18px 0 0",
          padding: "18px 18px 26px",
          maxHeight: "88%",
          overflowY: "auto",
        }}
      >
        {done ? (
          <div style={{ textAlign: "center", padding: "14px 4px" }}>
            <div aria-hidden="true" style={{ fontSize: 30, color: FOREST }}>✓</div>
            <h3 style={{ fontSize: 17, color: INK, margin: "10px 0 6px", fontWeight: 600 }}>Payment received</h3>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: "0 0 16px" }}>
              Thank you — your maintenance is being confirmed. Your coverage updates here shortly.
            </p>
            <button onClick={onClose} style={{ fontSize: 14, fontWeight: 600, padding: "11px 22px", borderRadius: 999, border: "none", background: FOREST, color: "#fff", cursor: "pointer" }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 17, color: INK, margin: 0, fontWeight: 600 }}>Maintain your gains</h3>
              <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", fontSize: 20, color: MUTED, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "0 0 14px" }}>
              A lighter plan to hold your progress — monthly do&apos;s &amp; don&apos;ts, your menus &amp; recipes, and regular check-ins. One-time payment, no auto-renewal.
            </p>

            <div style={{ display: "grid", gap: 9, marginBottom: 14 }}>
              {pricing.map((p) => {
                const on = p.termMonths === term;
                const perMonth = Math.round(p.inr / p.termMonths);
                return (
                  <button
                    key={p.termMonths}
                    onClick={() => setTerm(p.termMonths)}
                    style={{
                      textAlign: "left",
                      border: `1.5px solid ${on ? FOREST : LINE}`,
                      background: on ? "rgba(45,90,61,0.06)" : "transparent",
                      borderRadius: 12,
                      padding: "12px 14px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>
                        {p.termMonths} month{p.termMonths === 1 ? "" : "s"}
                      </div>
                      <div style={{ fontSize: 12, color: MUTED }}>{inr(perMonth)}/month</div>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: FOREST }}>{inr(p.inr)}</div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={pay}
              disabled={busy || !selected}
              style={{ width: "100%", fontSize: 15, fontWeight: 600, padding: "13px", borderRadius: 12, border: "none", background: FOREST, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "Starting payment…" : selected ? `Pay ${inr(selected.inr)}` : "Unavailable"}
            </button>
            {error && <div style={{ fontSize: 12.5, color: "#b3402a", marginTop: 9, textAlign: "center" }}>{error}</div>}
            <p style={{ fontSize: 11, color: MUTED, textAlign: "center", margin: "10px 0 0" }}>
              Secure payment via Razorpay · UPI, cards &amp; netbanking
            </p>
          </>
        )}
      </div>
    </div>
  );
}

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

export function EndgameBanner({ goCoach, onRenew }: { goCoach: () => void; onRenew: () => void }) {
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
      {cta && <CtaButton label={cta} onClick={endgame.mode === "GRACE" ? onRenew : goCoach} tone={fg} />}
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

      <KeepsakeLink recipeCount={(data.recipePack ?? []).length} />
    </div>
  );
}

/** This month's do's & don'ts — the living thing in maintenance. */
function MonthlyCardView({ card }: { card: { title: string; dos: string[]; donts: string[] } }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>{card.title}</div>
      {card.dos.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: FOREST, textTransform: "uppercase", letterSpacing: 0.5 }}>Lean into</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13, color: INK, lineHeight: 1.55 }}>
            {card.dos.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {card.donts.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: OCHRE, textTransform: "uppercase", letterSpacing: 0.5 }}>Ease off</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13, color: INK, lineHeight: 1.55 }}>
            {card.donts.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The back-on-track (flare-reset) card — shared by maintenance + library. */
function BackOnTrackCard({ bot }: { bot: { title: string; intro: string; steps: string[] } }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14.5, fontWeight: 500, color: FOREST }}>{bot.title}</div>
      {bot.intro && <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 8px" }}>{bot.intro}</p>}
      {bot.steps.length > 0 && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: INK, lineHeight: 1.6 }}>
          {bot.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The recipe keepsake — a print-ready PDF of every recipe, opened in a new tab
 *  (/app/<token>/keepsake). A parting gift at graduation + the library floor. */
function KeepsakeLink({ recipeCount }: { recipeCount: number }) {
  const { token } = useOchre();
  if (!recipeCount) return null;
  return (
    <a
      href={`/app/${token}/keepsake`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...cardStyle, display: "block", textDecoration: "none", marginTop: 14 }}
    >
      <div style={{ fontSize: 14.5, fontWeight: 500, color: FOREST }}>📖 Your recipe keepsake</div>
      <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 0" }}>
        All {recipeCount} of your recipes in one place — open and save as a PDF to keep forever.
      </p>
      <div style={{ marginTop: 9, fontSize: 13, color: FOREST, fontWeight: 600 }}>Open keepsake →</div>
    </a>
  );
}

/** MAINTENANCE — the hands-free lighter home. The full app (menus, recipes,
 *  tracking) stays open via the tabs; this home surfaces the month's card, the
 *  back-on-track reset, and a calm "everything's here" framing. */
export function MaintenanceHome({ goTab, onRenew }: { goTab: (t: string) => void; onRenew: () => void }) {
  const { endgame, client } = useOchre();
  const monthly = endgame?.monthlyCard ?? null;
  const bot = endgame?.backOnTrack ?? null;
  const renewalDue = endgame?.renewalDueLabel ?? null;
  return (
    <div style={{ padding: "8px 14px 24px" }}>
      <div style={{ textAlign: "center", padding: "18px 8px 10px" }}>
        <div aria-hidden="true" style={{ fontSize: 26, color: FOREST }}>✦</div>
        <h2 style={{ fontSize: 19, color: INK, margin: "10px 0 6px", fontWeight: 500 }}>
          You&apos;re holding your gains, {client.firstName}
        </h2>
        <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, margin: 0 }}>
          {endgame?.paidThroughLabel
            ? `Lighter touch, same support — your maintenance runs through ${endgame.paidThroughLabel}.`
            : "Lighter touch, same support."}
        </p>
      </div>

      {renewalDue && (
        <div style={{ ...cardStyle, borderColor: OCHRE, background: "rgba(176,123,30,0.06)" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>Time to renew</div>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "5px 0 0" }}>
            Your maintenance runs out on {renewalDue}. Renew to keep your menus, monthly guidance and check-ins going.
          </p>
          <CtaButton label="Renew my maintenance" onClick={onRenew} />
        </div>
      )}

      {monthly && <MonthlyCardView card={monthly} />}
      {bot && <BackOnTrackCard bot={bot} />}

      <div style={cardStyle}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>Everything stays open</div>
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: "5px 0 0" }}>
          Your menus, recipes and tracking are all here whenever you want them.
        </p>
        <CtaButton label="Open my plan + recipes" onClick={() => goTab("plan")} />
      </div>
    </div>
  );
}

export function LibraryFloorScreen({ goCoach, goTab }: { goCoach: () => void; goTab: (t: string) => void }) {
  const data = useOchre();
  const { endgame, client, coach } = data;
  const bot = endgame?.backOnTrack ?? null;
  const sampleRecipes = (data.recipePack ?? []).slice(0, 4);
  const buyableSupps = (data.allSupplements ?? []).filter((s) => s.buyUrl).slice(0, 6);

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

      {sampleRecipes.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>A taste of your recipes</div>
          <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "4px 0 8px" }}>
            A few of your favourites stay open. The full collection comes home in your graduation keepsake.
          </p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {sampleRecipes.map((r, i) => (
              <li key={i} style={{ fontSize: 13, color: INK, display: "flex", gap: 8, alignItems: "baseline" }}>
                <span aria-hidden="true" style={{ color: FOREST }}>·</span>
                <span>{r.title}{r.time ? <span style={{ color: MUTED }}> · {r.time}</span> : null}</span>
              </li>
            ))}
          </ul>
          <CtaButton label="Browse the recipe library" onClick={() => goTab("plan")} />
        </div>
      )}

      {buyableSupps.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>Your supplements stay live</div>
          <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "4px 0 8px" }}>
            Re-order anytime — your links don&apos;t expire.
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {buyableSupps.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, color: INK }}>
                <span>{s.name}</span>
                <a href={s.buyUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: FOREST, fontWeight: 500, whiteSpace: "nowrap" }}>
                  Re-order →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {bot && <BackOnTrackCard bot={bot} />}

      <KeepsakeLink recipeCount={(data.recipePack ?? []).length} />

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
