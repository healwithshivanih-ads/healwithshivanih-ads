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
 * Maintenance / renewal checkout overlay. Two ways to maintain:
 *   - One-time block (e.g. 6 months ₹10,000) — manual; the webhook flips the order
 *     to paid + extends coverage. No auto-renew.
 *   - Quarterly subscription (₹6,000) — a Razorpay auto-debit mandate (when the
 *     plan is configured); Razorpay charges every 3 months, the subscription.charged
 *     webhook extends coverage. Authorize once.
 * The Checkout success handler only shows a "processing" state — the verified
 * webhook is the source of truth; coverage updates on next app load.
 */
export function MaintenanceCheckout({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const pricing = data.endgame?.pricing ?? [];
  const subOffer = data.endgame?.subscriptionOffer ?? null;
  const subActive = data.endgame?.subscriptionActive ?? false;
  const subShown = !!subOffer && !subActive;

  // Selection: "sub" or a one-time term as a string. Default to the subscription
  // (best value) when offered, else the first one-time block.
  const [sel, setSel] = useState<string>(subShown ? "sub" : String(pricing[0]?.termMonths ?? 6));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "onetime" | "sub">(null);
  const [error, setError] = useState("");

  const oneTime = pricing.find((p) => String(p.termMonths) === sel) ?? null;
  const isSub = sel === "sub";

  const launch = (opts: Record<string, unknown>, onOk: () => void) => {
    const Ctor = window.Razorpay;
    if (!Ctor) throw new Error("payment is unavailable right now");
    const rzp = new Ctor({
      name: "The Ochre Tree",
      theme: { color: "#2d5a3d" },
      handler: onOk, // webhook is the source of truth
      ...opts,
    });
    rzp.open();
  };

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error("payment is unavailable right now");
      if (isSub) {
        const res = await fetch(`/api/maintenance/${data.clientId}/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: data.token }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string; subscription_id?: string; keyId?: string };
        if (!j.ok) throw new Error(j.error || "could not start subscription");
        launch(
          { key: j.keyId, subscription_id: j.subscription_id, description: "Quarterly maintenance (auto-renews)" },
          () => setDone("sub"),
        );
      } else {
        const termMonths = oneTime?.termMonths ?? 6;
        const res = await fetch(`/api/maintenance/${data.clientId}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termMonths, token: data.token }),
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
        launch(
          {
            key: j.keyId,
            order_id: j.razorpay_order_id,
            amount: (j.amount_inr ?? oneTime?.inr ?? 0) * 100,
            currency: j.currency ?? "INR",
            description: `Maintenance — ${termMonths} months`,
          },
          () => setDone("onetime"),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "payment failed");
    } finally {
      setBusy(false);
    }
  };

  const cta = busy
    ? isSub ? "Starting…" : "Starting payment…"
    : isSub
      ? `Set up auto-renew · ${subOffer ? inr(subOffer.inr) : ""}/quarter`
      : oneTime ? `Pay ${inr(oneTime.inr)}` : "Unavailable";

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
            <h3 style={{ fontSize: 17, color: INK, margin: "10px 0 6px", fontWeight: 600 }}>
              {done === "sub" ? "Auto-renew set up" : "Payment received"}
            </h3>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: "0 0 16px" }}>
              {done === "sub"
                ? "Thank you — your quarterly plan is being confirmed. You'll be charged automatically each quarter; we'll always remind you first."
                : "Thank you — your maintenance is being confirmed. Your coverage updates here shortly."}
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
              A lighter plan to hold your progress — monthly do&apos;s &amp; don&apos;ts, your menus &amp; recipes, and regular check-ins.
            </p>

            {subActive && (
              <div style={{ ...cardStyle, borderColor: FOREST, background: "rgba(45,90,61,0.06)" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: FOREST }}>✓ Auto-renew is on</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
                  Your quarterly plan renews automatically — nothing to do.
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: 9, marginBottom: 14 }}>
              {subShown && subOffer && (
                <button
                  onClick={() => setSel("sub")}
                  style={{
                    textAlign: "left",
                    border: `1.5px solid ${isSub ? FOREST : LINE}`,
                    background: isSub ? "rgba(45,90,61,0.06)" : "transparent",
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
                      Quarterly{" "}
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: FOREST, background: "rgba(45,90,61,0.12)", padding: "2px 7px", borderRadius: 999, marginLeft: 4 }}>
                        AUTO-RENEW
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: MUTED }}>Charged every 3 months · cancel anytime</div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: FOREST }}>{inr(subOffer.inr)}</div>
                </button>
              )}

              {pricing.map((p) => {
                const on = !isSub && String(p.termMonths) === sel;
                return (
                  <button
                    key={p.termMonths}
                    onClick={() => setSel(String(p.termMonths))}
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
                        {p.termMonths} months
                      </div>
                      <div style={{ fontSize: 12, color: MUTED }}>One-time · no auto-renew</div>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: FOREST }}>{inr(p.inr)}</div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={start}
              disabled={busy || (isSub ? !subOffer : !oneTime)}
              style={{ width: "100%", fontSize: 15, fontWeight: 600, padding: "13px", borderRadius: 12, border: "none", background: FOREST, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {cta}
            </button>
            {error && <div style={{ fontSize: 12.5, color: "#b3402a", marginTop: 9, textAlign: "center" }}>{error}</div>}
            <p style={{ fontSize: 11, color: MUTED, textAlign: "center", margin: "10px 0 0" }}>
              {isSub
                ? "Secure auto-debit via Razorpay · you're notified before every charge"
                : "Secure payment via Razorpay · UPI, cards & netbanking"}
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
  const { endgame, client } = useOchre();
  // LIBRARY has its own full screen; ACTIVE has no banner.
  if (!endgame || endgame.mode === "LIBRARY") return null;

  let tint = "rgba(45,90,61,0.09)";
  let border = "rgba(45,90,61,0.20)";
  let fg = FOREST;
  let title = "";
  let body = "";
  let cta: string | null = null;

  if (endgame.mode === "REVIEW") {
    title = `Your ${client.totalWeeks} weeks are wrapping up`;
    // Short engagements get one track (the full programme); standard plans two.
    const whatNext = endgame.shortEngagement
      ? "Let's plan what's next — the full programme picks up right where this month leaves off."
      : "Let's choose what's next — a fresh phase, or a lighter maintenance plan.";
    body = endgame.recheckLabel
      ? `You reach your recheck point around ${endgame.recheckLabel}. ${whatNext}`
      : whatNext;
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
  // Before the recheck date the client is still in-protocol (REVIEW opens ~2
  // weeks early to drive the decision) — say "final stretch", not "reached".
  const approaching = data.endgame?.approaching ?? false;

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
          {approaching
            ? `You're in the final stretch, ${client.firstName}`
            : `You've reached the finish line, ${client.firstName}`}
        </h2>
        <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, margin: 0 }}>
          {stats.length > 0
            ? "Look how far you've come — your journey in numbers."
            : approaching
              ? `You're almost through your ${client.totalWeeks} weeks. Let's choose what comes next.`
              : "You've completed your plan. Let's choose what comes next."}
        </p>
      </div>

      {stats.map((s) => (
        <ProgressStat key={s.label} {...s} />
      ))}

      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: INK }}>What&apos;s next?</div>
        {data.endgame?.shortEngagement ? (
          <>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "5px 0 11px" }}>
              This month was the foundation — {coach.name} tailors the full programme to where you are now.
            </p>
            <ChoiceCard title="Continue" sub="The full programme — deeper protocol phases, and the retests that show your numbers moving." onClick={onContinue} />
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "5px 0 11px" }}>
              Two ways to keep your momentum — {coach.name} tailors either to where you are now.
            </p>
            <ChoiceCard title="Continue" sub="A fresh phase — keep building on what's working." onClick={onContinue} />
            <ChoiceCard title="Maintain" sub="A lighter plan to hold your gains, with regular check-ins." onClick={onMaintain} />
          </>
        )}
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
function BackOnTrackCard({
  bot,
}: {
  bot: { title: string; intro: string; steps: string[]; redFlags: string[] };
}) {
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
      {bot.redFlags.length > 0 && (
        <div
          style={{
            marginTop: 11,
            padding: "9px 11px",
            borderRadius: 9,
            background: "rgba(155, 59, 48, 0.07)",
            border: "1px solid rgba(155, 59, 48, 0.22)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9b3b30", marginBottom: 4 }}>
            When a reset isn&apos;t enough
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: INK, lineHeight: 1.55 }}>
            {bot.redFlags.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
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
          {data.endgame?.shortEngagement
            ? <>When you&apos;re ready for the full programme, {coach.name} is one message away.</>
            : <>Whether it&apos;s a new focus or a lighter maintenance plan, {coach.name} is one message away.</>}
        </p>
        <CtaButton label={`Talk to ${coach.name}`} onClick={goCoach} />
      </div>
    </div>
  );
}
