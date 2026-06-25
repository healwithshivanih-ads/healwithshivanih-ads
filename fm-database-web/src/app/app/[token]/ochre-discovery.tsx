"use client";

/**
 * Discovery-tier screens — the consult-only ("Map, not Journey") app surface.
 * Rendered when data.tier === "discovery" (a client with an app_token but no
 * published plan). Read-only: the Starting Map summary + Lab Vault are open;
 * Plan/Progress are locked; the Coach tab is an upgrade CTA (no message thread).
 * See docs/DISCOVERY_TIER_SPEC.md.
 */

import { Icon } from "./ochre-context";
import { useOchre } from "./ochre-context";
import { LabOrdersCard } from "./ochre-lab-pay";
import type { DiscoveryStage } from "@/lib/fmdb/discovery-tier";

/** Format a YYYY-MM-DD as "10 Jul 2026" (UTC — the date is day-granular). */
function humanDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function waHref(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * The upgrade call-to-action — the only "contact channel" in discovery mode.
 * Purely commercial (upgrade / re-book), never a support thread. Its copy is
 * driven by the date-resolved credit window (credit_live vs credit_expired).
 */
export function UpgradeCta() {
  const { discoveryCredit: credit, coach } = useOchre();
  const live = credit?.state === "credit_live";

  const title = live ? "Ready for the full journey?" : "Continue your journey";
  const body = live
    ? "Your ₹12,000 consult adjusts in full against the programme — so upgrading costs only the difference."
    : "Your consult-credit window has closed. You can begin the full programme, or book a fresh discovery call — its fee then credits toward your package.";
  const waText = live
    ? "Hi,I'd like to upgrade to the full programme after my discovery call."
    : "Hi,I'd like to continue — could you tell me about starting the full programme or booking another discovery call?";
  const btnLabel = live ? "Upgrade my plan" : "Talk to us";

  return (
    <div
      className="rightnow"
      style={{ marginTop: 14, background: "var(--forest)", color: "#fff" }}
    >
      <div className="rn-body">
        <div className="rn-eyebrow" style={{ color: "rgba(255,255,255,0.85)" }}>
          <Icon name="sparkle" size={14} /> {live ? "Your credit applies" : "Credit window closed"}
        </div>
        <div className="rn-title" style={{ color: "#fff", fontSize: 18 }}>{title}</div>
        <div className="rn-sub" style={{ color: "rgba(255,255,255,0.9)", marginBottom: 12 }}>{body}</div>

        {live && credit?.expiresOn && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: "rgba(255,255,255,0.16)",
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 12.5,
              marginBottom: 12,
            }}
          >
            <Icon name="clock" size={13} />
            Applies until <strong>{humanDate(credit.expiresOn)}</strong>
            {credit.daysLeft != null && (
              <span style={{ opacity: 0.85 }}>
                · {credit.daysLeft === 0 ? "last day" : `${credit.daysLeft} day${credit.daysLeft === 1 ? "" : "s"} left`}
              </span>
            )}
          </div>
        )}

        <a
          className="wa-btn"
          style={{ width: "auto", padding: "12px 20px", background: "#fff", color: "var(--forest)" }}
          href={waHref(coach.whatsappNumber, waText)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="whatsapp" size={17} /> {btnLabel}
        </a>
      </div>
    </div>
  );
}

/** A small "Questions? WhatsApp us" link — logistical only, not coaching. */
function PlainContactLine() {
  const { coach } = useOchre();
  return (
    <div className="coach-line" style={{ marginTop: 14 }}>
      <Icon name="whatsapp" size={18} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <div className="q">
          Any questions about your report or the programme? Message your coach anytime.
        </div>
        <a
          className="who"
          style={{ color: "var(--forest)", textDecoration: "none" }}
          href={waHref(coach.whatsappNumber, "Hi,a quick question about my discovery summary —")}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp us →
        </a>
      </div>
    </div>
  );
}

function PointCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="card" style={{ padding: "12px 14px", marginBottom: 10 }}>
      {title && <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", marginBottom: note ? 4 : 0 }}>{title}</div>}
      {note && <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}>{note}</div>}
    </div>
  );
}

/** The "Your Starting Map" summary — rendered in the Today tab slot. */
export function DiscoverySummaryScreen() {
  const { client, discoverySummary: sum } = useOchre();

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Hi {client.firstName}</div>
        <div className="date script">Your starting map</div>
      </div>

      {sum?.headline && (
        <div className="rightnow" style={{ marginTop: 4 }}>
          <div className="rn-body">
            <div className="rn-eyebrow">
              <Icon name="sparkle" size={14} /> From your discovery call
            </div>
            <div className="rn-title" style={{ fontSize: 18 }}>{sum.headline}</div>
          </div>
        </div>
      )}

      {/* Root-cause hypotheses */}
      <section className="section" style={{ marginTop: 18 }}>
        <div className="section-head"><h2>What I&apos;m seeing</h2></div>
        {sum && sum.hypotheses.length > 0 ? (
          sum.hypotheses.map((h, i) => <PointCard key={i} title={h.title} note={h.note} />)
        ) : (
          <div className="card" style={{ padding: "14px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
            Your starting map is being put together. It&apos;ll appear here right after your call.
          </div>
        )}
      </section>

      {/* Foundational starting changes */}
      {sum && sum.foundationalChanges.length > 0 && (
        <section className="section" style={{ marginTop: 8 }}>
          <div className="section-head"><h2>Start here</h2></div>
          {sum.foundationalChanges.map((c, i) => <PointCard key={i} title={c.title} note={c.note} />)}
        </section>
      )}

      {/* What the full journey adds — the honest upsell bridge */}
      {sum && sum.journeyPreview.length > 0 && (
        <section className="section" style={{ marginTop: 8 }}>
          <div className="section-head"><h2>Your full journey would add</h2></div>
          <div className="card" style={{ padding: "6px 4px" }}>
            {sum.journeyPreview.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "9px 12px",
                  borderBottom: i < sum.journeyPreview.length - 1 ? "1px solid var(--line)" : "none",
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden>🔒</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{item}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <UpgradeCta />
      <PlainContactLine />
    </div>
  );
}

/** Locked plan-content tab (Plan / Progress) — the "silent salesman". */
export function DiscoveryLockedScreen({ feature }: { feature: "plan" | "progress" }) {
  const meta =
    feature === "plan"
      ? { title: "Your personalised plan", body: "Your full meal plan, supplement schedule, daily routine and recipes are part of the programme — built around your reports, not a template." }
      : { title: "Your progress tracker", body: "Weekly check-ins, symptom trends and your tracking charts unlock with the full programme, so we can adjust as you go." };

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">{meta.title}</div>
        <div className="date script">Part of your full journey</div>
      </div>

      <div className="rightnow" style={{ marginTop: 4 }}>
        <div className="rn-body" style={{ textAlign: "center", padding: "8px 4px" }}>
          <div style={{ fontSize: 34, marginBottom: 6 }} aria-hidden>🔒</div>
          <div className="rn-title" style={{ fontSize: 18 }}>Unlocks with your full journey</div>
          <div className="rn-sub" style={{ marginBottom: 0 }}>{meta.body}</div>
        </div>
      </div>

      <UpgradeCta />
      <PlainContactLine />
    </div>
  );
}

/** Discovery Coach tab — upgrade CTA + plain WhatsApp, never a message thread. */
export function DiscoveryCoachScreen() {
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Your next step</div>
        <div className="date script">When you&apos;re ready</div>
      </div>
      <UpgradeCta />
      <PlainContactLine />
    </div>
  );
}

/* ── Pre-call onboarding ─────────────────────────────────────────────────────
 * Before the discovery call, the app is a guided onboarding — NOT the Starting
 * Map. Recommendations + the upgrade countdown stay hidden until the labs are in
 * and the coach marks the call done (coach rule 2026-06-25). The flow:
 *   intake → book labs → sample & results → discovery call → (map opens)
 * Rendered full-screen (no bottom nav) for every stage except post_call. */

const ONBOARD_STEPS = ["Your intake", "Book labs", "Sample & results", "Discovery call"];

function stageStepIndex(stage: DiscoveryStage): number {
  switch (stage) {
    case "onboard_intake":
      return 0;
    case "awaiting_recommendation":
    case "book_labs":
      return 1;
    case "awaiting_results":
      return 2;
    case "awaiting_call":
      return 3;
    default:
      return 3; // post_call — onboarding isn't shown for it
  }
}

function OnboardStepper({ active }: { active: number }) {
  return (
    <div style={{ display: "flex", gap: 6, margin: "2px 0 18px" }} aria-hidden>
      {ONBOARD_STEPS.map((label, i) => {
        const cur = i === active;
        const done = i < active;
        return (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div
              style={{
                height: 4,
                borderRadius: 999,
                background: done || cur ? "var(--forest, #2d5a3d)" : "var(--line, #e6e1d6)",
                opacity: done ? 0.65 : 1,
              }}
            />
            <div
              style={{
                fontSize: 10.5,
                marginTop: 5,
                lineHeight: 1.2,
                color: cur ? "var(--forest, #2d5a3d)" : "var(--muted, #6f6a5d)",
                fontWeight: cur ? 700 : 500,
              }}
            >
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OnboardCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="rightnow" style={{ marginTop: 4 }}>
      <div className="rn-body" style={{ textAlign: "center", padding: "10px 6px" }}>
        <div style={{ fontSize: 32, marginBottom: 6 }} aria-hidden>{icon}</div>
        <div className="rn-title" style={{ fontSize: 18 }}>{title}</div>
        <div className="rn-sub" style={{ marginBottom: 0 }}>{body}</div>
      </div>
    </div>
  );
}

/** Logistics-only contact — neutral copy that fits the pre-call stages. */
function OnboardContactLine() {
  const { coach } = useOchre();
  return (
    <div className="coach-line" style={{ marginTop: 16 }}>
      <Icon name="whatsapp" size={18} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <div className="q">Stuck on a step, or want to change something? We&apos;re a message away.</div>
        <a
          className="who"
          style={{ color: "var(--forest)", textDecoration: "none" }}
          href={waHref(coach.whatsappNumber, "Hi,a question about getting started on the app —")}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp us →
        </a>
      </div>
    </div>
  );
}

export function DiscoveryOnboardingScreen() {
  const data = useOchre();
  const stage: DiscoveryStage = data.discoveryStage ?? "onboard_intake";
  const { client, intakeUrl } = data;

  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Hi {client.firstName}</div>
        <div className="date script">Welcome to The Ochre Tree</div>
      </div>

      <OnboardStepper active={stageStepIndex(stage)} />

      {stage === "onboard_intake" && (
        <>
          <OnboardCard
            icon="📝"
            title="Let&apos;s start with your story"
            body="A short intake form — your history, symptoms and goals. Everything in your plan is built from this, so take your time."
          />
          {intakeUrl ? (
            <a
              className="submit-btn"
              style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 14 }}
              href={intakeUrl}
            >
              Start my intake →
            </a>
          ) : (
            <div
              className="card"
              style={{ padding: 14, marginTop: 14, fontSize: 13, color: "var(--muted)", lineHeight: 1.5, textAlign: "center" }}
            >
              Your intake link is on its way over WhatsApp — open it there and your answers will appear here.
            </div>
          )}
        </>
      )}

      {stage === "awaiting_recommendation" && (
        <OnboardCard
          icon="🌿"
          title="Thanks — that&apos;s the biggest step"
          body="We&apos;re reading through your intake and choosing the lab tests that matter most for you. They&apos;ll appear here to book, usually within a day or two."
        />
      )}

      {stage === "book_labs" && (
        <>
          <OnboardCard
            icon="🧪"
            title="Your labs are ready"
            body="Based on your intake, here are the tests we&apos;d like to run. Book a home collection below — we&apos;ll arrange the rest."
          />
          <div style={{ marginTop: 16 }}>
            <LabOrdersCard />
          </div>
        </>
      )}

      {stage === "awaiting_results" && (
        <OnboardCard
          icon="🚚"
          title="Your sample is on the way"
          body="We&apos;re arranging your home collection. Once your results come in, we&apos;ll add them to your vault and set up your discovery call."
        />
      )}

      {stage === "awaiting_call" && (
        <OnboardCard
          icon="📞"
          title="Your results are in"
          body="Your discovery call is next — we&apos;ll reach out on WhatsApp to find a time. Right after the call, your starting map opens up here."
        />
      )}

      <OnboardContactLine />
    </div>
  );
}
