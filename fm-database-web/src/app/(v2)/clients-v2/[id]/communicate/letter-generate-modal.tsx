/**
 * LetterGenerateTrigger — button + modal that drives letter generation
 * directly from the new Communicate hero CTA.
 *
 * Replaces the broken UX where the hero linked to /letter-editor and
 * bounced back when no letter existed yet. Two modes:
 *
 *   mode="initial" — first send. Generates ONLY the consolidated
 *     "Full wellness letter" (REQUIRED_LETTERS) — ONE Sonnet call.
 *     supplement_plan + lifestyle_guide are NOT generated as separate
 *     AI calls; they are section-extracted from the consolidated letter
 *     for free. exercise_plan + recipes are OPT-IN add-ons (OPTIONAL_ADDONS)
 *     — unchecked by default; the coach ticks them only if the client
 *     specifically wants the standalone versions. After completion,
 *     "Open in letter editor →" links to the consolidated letter.
 *
 *   mode="phase"  — subsequent fortnight. Generates a single
 *     meal_plan_phase letter for [phase.startWeek, phase.endWeek] via
 *     generatePhaseMealPlanAction(). Progress is shown as a single
 *     spinner because phase generation is one big call (3–5 min on
 *     Sonnet).
 *
 * Cost note: the default initial package is ONE `generateClientLetter`
 * Sonnet call (~$0.30–0.50). Each opted-in add-on (exercise / recipes)
 * is one extra call (~$0.10–0.20). Cached on disk after first run —
 * re-opening the modal hits the cache.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  generateClientLetter,
  generatePhaseMealPlanAction,
  type LetterType,
} from "@/lib/server-actions/plan-lifecycle";

type Mode = "initial" | "phase" | "single";

interface LetterGenerateTriggerProps {
  clientId: string;
  planSlug: string;
  mode: Mode;
  label: string;                        // CTA label inside the hero
  tone?: "primary" | "warning" | "secondary" | "danger";
  /** Required when mode === "phase". */
  phase?: { startWeek: number; endWeek: number };
  /** Required when mode === "single" — the one letter type to generate. */
  letterType?: LetterType;
  /** Human label for the single letter (shown in the modal + progress). */
  letterLabel?: string;
  /** Optional readiness signals — shown as soft warnings in the modal
   *  before the API call fires (B9 audit 2026-05-19). Coach can still
   *  proceed; these are informational not blocking. */
  readiness?: {
    /** True when no client voice in the last 14d (check-ins, WhatsApp,
     *  pre-session brief). Letter will be generic. */
    voiceBlockEmpty?: boolean;
    /** True when the client has zero lab values on file. */
    labsAbsent?: boolean;
    /** Days since last session, if any. */
    daysSinceLastSession?: number;
  };
}

// Initial package generation strategy:
//   1. ALWAYS generate `consolidated` — this is the source of truth.
//      One Sonnet call (~$0.30–0.50).
//   2. Extract `supplement_plan` + `lifestyle_guide` from consolidated
//      using existing section-marker logic — ZERO additional AI calls.
//   3. `exercise_plan` + `recipes` are opt-in add-ons (separate AI
//      calls, ~$0.10–0.20 each). Most clients don't need them in the
//      initial package; coach can generate later from the letter editor
//      when she wants the standalone version.
const REQUIRED_LETTERS: { type: LetterType; label: string; note: string }[] = [
  {
    type: "consolidated",
    label: "Welcome letter",
    note: "The one worded letter. Menus, supplements, lifestyle and recipes live in the app.",
  },
];

// LETTERS RETIRED (2026-06-12): exercise_plan + recipes add-ons removed —
// recipes render in-app from the structured library; movement lives on
// the plan. Empty list keeps the modal's add-on loop a no-op.
const OPTIONAL_ADDONS: { type: LetterType; label: string; note: string }[] = [];

type StepStatus = "pending" | "running" | "done" | "failed";

export function LetterGenerateTrigger({
  clientId,
  planSlug,
  mode,
  label,
  tone = "primary",
  phase,
  letterType,
  letterLabel,
  readiness,
}: LetterGenerateTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="hero-cta"
        onClick={() => setOpen(true)}
      >
        {label}
        <span className="chev">→</span>
      </button>
      {open && (
        <GenerateModal
          clientId={clientId}
          planSlug={planSlug}
          mode={mode}
          phase={phase}
          letterType={letterType}
          letterLabel={letterLabel}
          onClose={() => setOpen(false)}
          tone={tone}
          readiness={readiness}
        />
      )}
    </>
  );
}

function GenerateModal({
  clientId,
  planSlug,
  mode,
  phase,
  letterType,
  letterLabel,
  onClose,
  tone,
  readiness,
}: {
  clientId: string;
  planSlug: string;
  mode: Mode;
  phase?: { startWeek: number; endWeek: number };
  letterType?: LetterType;
  letterLabel?: string;
  onClose: () => void;
  tone: "primary" | "warning" | "secondary" | "danger";
  readiness?: LetterGenerateTriggerProps["readiness"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Default: no add-ons checked. Coach must opt in.
  const [addOns, setAddOns] = useState<Record<string, boolean>>({});
  const initialPlan = mode === "initial"
    ? [
        ...REQUIRED_LETTERS,
        ...OPTIONAL_ADDONS.filter((a) => addOns[a.type]),
      ]
    : [];
  const [steps, setSteps] = useState<StepStatus[]>(() =>
    mode === "initial"
      ? Array(REQUIRED_LETTERS.length).fill("pending")
      : ["pending"],
  );
  const [error, setError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);

  const setStep = (i: number, s: StepStatus) =>
    setSteps((prev) => prev.map((x, k) => (k === i ? s : x)));

  const runInitial = () => {
    setError(null);
    setAllDone(false);
    // Re-snapshot the run list at click time so unchecked add-ons aren't included.
    const runList: { type: LetterType; label: string }[] = [
      ...REQUIRED_LETTERS,
      ...OPTIONAL_ADDONS.filter((a) => addOns[a.type]),
    ];
    setSteps(runList.map(() => "pending"));

    startTransition(async () => {
      for (let i = 0; i < runList.length; i++) {
        setStep(i, "running");
        try {
          const res = await generateClientLetter(
            planSlug,
            clientId,
            undefined,                  // weight_loss read server-side from client.yaml
            runList[i].type,
            undefined,                  // coach_notes
            false,                      // forceRegenerate — re-uses cached files
          );
          if (!res.ok) {
            setStep(i, "failed");
            setError(
              `${runList[i].label} failed: ${res.error ?? "unknown error"}`,
            );
            return;
          }
          setStep(i, "done");
        } catch (err) {
          setStep(i, "failed");
          setError(
            `${runList[i].label} crashed: ${(err as Error).message}`,
          );
          return;
        }
      }
      setAllDone(true);
      toast.success("Initial package ready");
      router.refresh();
    });
  };

  const runPhase = () => {
    if (!phase) {
      setError("Phase range missing");
      return;
    }
    setError(null);
    setAllDone(false);
    startTransition(async () => {
      setStep(0, "running");
      try {
        const res = await generatePhaseMealPlanAction(
          planSlug,
          clientId,
          phase.startWeek,
          phase.endWeek,
          undefined,
          false,
        );
        if (!res.ok) {
          setStep(0, "failed");
          setError(res.error ?? "Phase generation failed");
          return;
        }
        setStep(0, "done");
        setAllDone(true);
        toast.success(`Wks ${phase.startWeek}–${phase.endWeek} generated`);
        router.refresh();
      } catch (err) {
        setStep(0, "failed");
        setError((err as Error).message);
      }
    });
  };

  // mode="single" — generate exactly one letter type via generateClientLetter.
  const runSingle = () => {
    if (!letterType) {
      setError("Letter type missing");
      return;
    }
    setError(null);
    setAllDone(false);
    startTransition(async () => {
      setStep(0, "running");
      try {
        const res = await generateClientLetter(
          planSlug,
          clientId,
          undefined,              // weight_loss read server-side
          letterType,
          undefined,              // coach_notes
          false,                  // forceRegenerate — reuse cache
        );
        if (!res.ok) {
          setStep(0, "failed");
          setError(res.error ?? "Generation failed");
          return;
        }
        setStep(0, "done");
        setAllDone(true);
        toast.success(`${letterLabel ?? "Letter"} generated`);
        router.refresh();
      } catch (err) {
        setStep(0, "failed");
        setError((err as Error).message);
      }
    });
  };

  const start =
    mode === "initial" ? runInitial : mode === "single" ? runSingle : runPhase;

  const heroTitle =
    mode === "initial"
      ? "Generate the initial package"
      : mode === "single"
        ? `Generate ${letterLabel ?? "letter"}`
        : `Generate Wks ${phase?.startWeek}–${phase?.endWeek} menu`;

  const description =
    mode === "initial"
      ? "One Sonnet call generates the full wellness letter — the source of truth. Supplement plan + lifestyle guide auto-extract from it (no extra cost). Optional add-ons below run separate calls only if checked."
      : mode === "single"
        ? `One Sonnet call generates the ${letterLabel ?? "letter"} on its own (~$0.10–0.40). Use this when you want just this document refreshed.`
        : "Generates the next fortnight's meal plan letter. The last check-in + 14 days of WhatsApp messages fold in automatically. Travel overrides for these dates are applied if set.";

  return (
    <div
      role="dialog"
      aria-modal
      onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 24, 0.55)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
          background: "var(--fm-surface, #fff)",
          border: "1px solid var(--fm-border-light, #E5E2DD)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
          padding: "22px 24px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <header style={{ display: "grid", gap: 6 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              color:
                tone === "warning"
                  ? "#92400e"
                  : tone === "secondary"
                    ? "var(--fm-secondary, #004E89)"
                    : "var(--fm-primary, #FF6B35)",
            }}
          >
            {mode === "initial"
              ? "Initial package"
              : mode === "single"
                ? "Single letter"
                : "Fortnight letter"}
          </div>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--fm-font-display, Libre Baskerville, Georgia, serif)",
              fontSize: 22,
              lineHeight: 1.2,
              color: "var(--fm-text, #1A1A1A)",
            }}
          >
            {heroTitle}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--fm-text-2, #5A5A5A)",
            }}
          >
            {description}
          </p>
        </header>

        {/* ⚠ Readiness warnings (B9 audit 2026-05-19) — informational
            soft warnings about gaps the letter will have if generated
            now. Coach can still proceed; this is so she's not surprised
            after spending $0.30+. */}
        {readiness && (readiness.voiceBlockEmpty || readiness.labsAbsent ||
          (readiness.daysSinceLastSession ?? 0) > 21) && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(245, 158, 11, 0.10)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: 8,
              display: "grid",
              gap: 4,
              fontSize: 12,
              color: "#78350f",
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "#92400e",
              }}
            >
              ⚠ Letter readiness
            </div>
            {readiness.voiceBlockEmpty && (
              <div>
                💬 No client check-ins or WhatsApp messages in the last 14 days.
                Letter will be generic — consider waiting for a check-in.
              </div>
            )}
            {readiness.labsAbsent && (
              <div>
                🧪 No lab values on file. Letter narrative will avoid lab-anchored
                claims; consider waiting until labs land for a more specific letter.
              </div>
            )}
            {readiness.daysSinceLastSession != null && readiness.daysSinceLastSession > 21 && (
              <div>
                ⏱ Last session was {readiness.daysSinceLastSession} days ago. Letter
                may not reflect current state — consider scheduling a session first.
              </div>
            )}
          </div>
        )}

        {/* Optional add-ons selector — only shown for initial-package mode,
            and only before generation kicks off. */}
        {mode === "initial" && !pending && !allDone && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--fm-bg-warm, #FAF8F4)",
              border: "1px dashed var(--fm-border-light, #E5E2DD)",
              borderRadius: 8,
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "var(--fm-text-3, #999)",
              }}
            >
              Optional add-ons (separate API calls)
            </div>
            {OPTIONAL_ADDONS.map((a) => (
              <label
                key={a.type}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!addOns[a.type]}
                  onChange={(e) =>
                    setAddOns((p) => ({ ...p, [a.type]: e.target.checked }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ fontWeight: 700, color: "var(--fm-text, #1A1A1A)" }}>
                    {a.label}
                  </span>
                  <span style={{ color: "var(--fm-text-2, #5A5A5A)" }}>
                    {" "}— {a.note}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Progress list — drawn from the actual run list (required +
            checked add-ons) so it matches what's being generated. */}
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {(mode === "initial"
            ? initialPlan.map((x) => x.label)
            : mode === "single"
              ? [letterLabel ?? "Letter"]
              : [`Wks ${phase?.startWeek}–${phase?.endWeek} meal plan`]
          ).map((lbl, i) => (
            <li
              key={lbl}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 8,
                background:
                  steps[i] === "done"
                    ? "rgba(16, 185, 129, 0.08)"
                    : steps[i] === "failed"
                      ? "rgba(220, 38, 38, 0.08)"
                      : steps[i] === "running"
                        ? "rgba(255, 107, 53, 0.08)"
                        : "var(--fm-bg-warm, #FAF8F4)",
                fontSize: 13,
                color: "var(--fm-text, #1A1A1A)",
              }}
            >
              <StatusDot status={steps[i]} />
              <span style={{ flex: 1 }}>{lbl}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--fm-font-mono, monospace)",
                  color:
                    steps[i] === "done"
                      ? "#047857"
                      : steps[i] === "failed"
                        ? "#b91c1c"
                        : steps[i] === "running"
                          ? "#b45309"
                          : "var(--fm-text-3, #999)",
                }}
              >
                {steps[i] === "done"
                  ? "✓ ready"
                  : steps[i] === "failed"
                    ? "failed"
                    : steps[i] === "running"
                      ? "generating…"
                      : "queued"}
              </span>
            </li>
          ))}
        </ul>

        {error && (
          <div
            style={{
              padding: "10px 12px",
              fontSize: 13,
              color: "#7f1d1d",
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.25)",
              borderRadius: 8,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {pending && (
          <div
            style={{
              fontSize: 12,
              color: "var(--fm-text-3, #999)",
              fontStyle: "italic",
              textAlign: "center",
            }}
          >
            Sonnet streaming — 3–5 min per letter. Don&apos;t close the tab.
          </div>
        )}

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid var(--fm-border-light, #E5E2DD)",
          }}
        >
          {!allDone && (
            <>
              <button
                type="button"
                className="FmBtn FmBtn--ghost"
                onClick={onClose}
                disabled={pending}
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  border: "1px solid var(--fm-border-light, #E5E2DD)",
                  borderRadius: 8,
                  cursor: pending ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={start}
                disabled={pending}
                style={{
                  padding: "8px 16px",
                  background: "var(--fm-primary, #FF6B35)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: pending ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  opacity: pending ? 0.55 : 1,
                }}
              >
                {pending
                  ? "Generating…"
                  : steps.some((s) => s === "failed")
                    ? "Retry"
                    : "Start generation"}
              </button>
            </>
          )}
          {allDone && (
            <>
              <a
                href={`/clients-v2/${clientId}/letter-editor?plan=${planSlug}${
                  mode === "phase" && phase
                    ? `&type=meal_plan_phase&phase_start=${phase.startWeek}&phase_end=${phase.endWeek}`
                    : mode === "single" && letterType
                      ? `&type=${letterType}`
                      : ""
                }`}
                style={{
                  padding: "8px 16px",
                  background: "var(--fm-primary, #FF6B35)",
                  color: "#fff",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                Open in letter editor →
              </a>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  border: "1px solid var(--fm-border-light, #E5E2DD)",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: StepStatus }) {
  const color =
    status === "done"
      ? "#10B981"
      : status === "failed"
        ? "#DC2626"
        : status === "running"
          ? "#FF6B35"
          : "#CBC9C4";
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        animation:
          status === "running"
            ? "pulse 1.2s ease-in-out infinite"
            : undefined,
      }}
    />
  );
}
