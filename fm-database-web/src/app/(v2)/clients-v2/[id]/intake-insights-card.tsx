"use client";

/**
 * IntakeInsightsCard — Phase 2 of the v0.72 intake insights feature.
 *
 * Mounted at the TOP of the right column on /clients-v2/[id] (above
 * FmContactPanel). Three states:
 *
 *   1. No intake submitted yet → tiny grey "📋 No intake on file yet" stub
 *      with a hint pointing the coach to SendIntakeFormButton below.
 *   2. Intake submitted but insights not generated → "✨ Generate insights"
 *      button. Single Haiku call (~$0.01-0.04).
 *   3. Insights present → 4 sections (patterns, red flags, top hypotheses,
 *      verify-in-session) + inline-editable coach_notes_for_ai (saves on
 *      blur via updateInsightsCoachNotes — does NOT trigger regeneration).
 *      Header strip has Refresh + View full intake link.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { FmPanel, FmChip } from "@/components/fm";
import {
  generateIntakeInsights,
  updateInsightsCoachNotes,
  type IntakeInsights,
} from "@/lib/server-actions/intake-insights";

interface Props {
  clientId: string;
  initial: IntakeInsights | null;
  submittedAt: string | null;
}

function relativeTime(iso: string): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    pct >= 70
      ? "var(--fm-primary)"
      : pct >= 45
        ? "#7a8e6e"
        : "var(--fm-text-tertiary)";
  return (
    <div
      style={{
        height: 4,
        background: "var(--fm-border-light)",
        borderRadius: 2,
        overflow: "hidden",
        marginTop: 4,
      }}
      aria-label={`Confidence ${Math.round(pct)}%`}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          transition: "width 200ms",
        }}
      />
    </div>
  );
}

export function IntakeInsightsCard({ clientId, initial, submittedAt }: Props) {
  const [insights, setInsights] = useState<IntakeInsights | null>(initial);
  const [coachNotes, setCoachNotes] = useState<string>(
    initial?.coach_notes_for_ai ?? "",
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingNote, startSavingNote] = useTransition();

  // STATE 1: no intake submitted yet
  if (!submittedAt && !insights) {
    return (
      <FmPanel title="📋 Intake insights" tight>
        <div
          style={{
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
            padding: "8px 0",
          }}
        >
          No intake form on file yet. Go to the Send &amp; unlock tab to share a tokenised link.
        </div>
      </FmPanel>
    );
  }

  function handleGenerate() {
    setErrorMsg(null);
    startTransition(async () => {
      // Pass whatever coach notes are currently in the textarea so corrections
      // override the AI on this run (and persist back to disk via the Python
      // shim). Avoids the "AI ignores my correction" pattern where notes were
      // only saved AFTER you regenerated.
      const res = await generateIntakeInsights(clientId, false, coachNotes);
      if (res.ok) {
        setInsights(res.insights);
        setCoachNotes(res.insights.coach_notes_for_ai ?? "");
      } else {
        setErrorMsg(res.error || "generation failed");
      }
    });
  }

  function handleSaveCoachNotes() {
    if (!insights) return;
    if ((coachNotes ?? "") === (insights.coach_notes_for_ai ?? "")) return;
    startSavingNote(async () => {
      const res = await updateInsightsCoachNotes(clientId, coachNotes);
      if (res.ok) {
        setInsights({ ...insights, coach_notes_for_ai: coachNotes });
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1800);
      } else {
        setErrorMsg(res.error || "save failed");
      }
    });
  }

  // STATE 2: submitted but no insights yet
  if (!insights) {
    return (
      <FmPanel
        title="📋 Intake insights"
        subtitle={`Intake submitted ${submittedAt ? relativeTime(submittedAt) : "—"}`}
        tight
      >
        <div style={{ display: "grid", gap: 10 }}>
          <p
            style={{
              fontSize: 12,
              color: "var(--fm-text-secondary)",
              margin: 0,
            }}
          >
            AI clinical summary not generated yet. Runs a single Haiku call
            (~$0.02) over the full intake.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            style={{
              padding: "8px 14px",
              background: "var(--fm-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.7 : 1,
              justifySelf: "start",
            }}
          >
            {pending ? "Generating…" : "✨ Generate insights"}
          </button>
          <Link
            href={`/clients-v2/${clientId}/intake-view`}
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              textDecoration: "none",
              justifySelf: "start",
            }}
          >
            📄 View full intake →
          </Link>
          {errorMsg && (
            <div
              style={{
                fontSize: 11,
                color: "var(--fm-danger, #b04646)",
                background: "rgba(176,70,70,0.08)",
                padding: "6px 8px",
                borderRadius: 4,
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>
      </FmPanel>
    );
  }

  // STATE 3: insights present
  return (
    <FmPanel
      title="📋 Intake insights"
      subtitle={
        <span>
          AI summary · {relativeTime(insights.generated_at)} ·{" "}
          <span style={{ opacity: 0.7 }}>{insights.model}</span>
        </span>
      }
      rightSlot={
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Link
            href={`/clients-v2/${clientId}/intake-view`}
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              textDecoration: "none",
              padding: "4px 8px",
              border: "1px solid var(--fm-border-light)",
              borderRadius: 4,
            }}
            title="Read every captured intake field"
          >
            📄 Full intake
          </Link>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
              border: "1px solid var(--fm-border)",
              borderRadius: 4,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
            title="Re-run Haiku over the latest intake"
          >
            {pending ? "Refreshing…" : "🔄 Refresh"}
          </button>
        </div>
      }
      tight
    >
      <div style={{ display: "grid", gap: 12 }}>
        {errorMsg && (
          <div
            style={{
              fontSize: 11,
              color: "#a13a3a",
              background: "rgba(176,70,70,0.08)",
              padding: "6px 8px",
              borderRadius: 4,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* ROOT CAUSE — emerald keystone, leads the card (Fix B 2026-05-23) */}
        {insights.root_cause && insights.root_cause.label && (
          <div
            style={{
              border: "1px solid rgba(46,125,90,0.35)",
              background: "rgba(46,125,90,0.06)",
              borderRadius: 6,
              padding: "10px 12px",
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "#2e7d5a",
                fontWeight: 600,
              }}
            >
              <span>🎯 Root cause</span>
              <span
                style={{
                  fontSize: 10,
                  background: "rgba(46,125,90,0.15)",
                  color: "#2e7d5a",
                  padding: "1px 6px",
                  borderRadius: 10,
                  letterSpacing: 0,
                  textTransform: "none",
                }}
              >
                confidence {Math.round((insights.root_cause.confidence ?? 0) * 100)}%
              </span>
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.4,
                color: "var(--fm-text-primary)",
                fontWeight: 600,
              }}
            >
              {insights.root_cause.label}
            </div>
            {insights.root_cause.reasoning && (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--fm-text-secondary)",
                }}
              >
                {insights.root_cause.reasoning}
              </div>
            )}
            {insights.root_cause.downstream_effects.length > 0 && (
              <div style={{ display: "grid", gap: 4 }}>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "var(--fm-text-tertiary)",
                  }}
                >
                  Will improve as root is addressed
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 16,
                    display: "grid",
                    gap: 2,
                  }}
                >
                  {insights.root_cause.downstream_effects.map((d, i) => (
                    <li
                      key={i}
                      style={{
                        fontSize: 12,
                        lineHeight: 1.45,
                        color: "var(--fm-text-secondary)",
                      }}
                    >
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* RED FLAGS — rose tint, protocol-gating */}
        {insights.red_flags.length > 0 && (
          <Section
            title="Red flags"
            tone="rose"
            count={insights.red_flags.length}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "grid",
                gap: 4,
              }}
            >
              {insights.red_flags.map((rf, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "#7a3535",
                  }}
                >
                  {rf}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* PATTERNS — indigo tint */}
        {insights.patterns.length > 0 && (
          <Section
            title="Clinical patterns"
            tone="indigo"
            count={insights.patterns.length}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "grid",
                gap: 4,
              }}
            >
              {insights.patterns.map((p, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "var(--fm-text-primary)",
                  }}
                >
                  {p}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* TOP HYPOTHESES — neutral with confidence bars */}
        {insights.top_hypotheses.length > 0 && (
          <Section
            title="Top FM hypotheses"
            tone="neutral"
            count={insights.top_hypotheses.length}
          >
            <div style={{ display: "grid", gap: 8 }}>
              {insights.top_hypotheses.map((h, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    padding: "6px 8px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border-light)",
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: "var(--fm-text-primary)",
                      }}
                    >
                      {h.driver}
                    </span>
                    <FmChip outline>
                      {Math.round((h.confidence ?? 0) * 100)}%
                    </FmChip>
                  </div>
                  <ConfidenceBar value={h.confidence ?? 0} />
                  <div
                    style={{
                      marginTop: 6,
                      color: "var(--fm-text-secondary)",
                      lineHeight: 1.4,
                    }}
                  >
                    {h.reasoning}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* VERIFY IN SESSION — sage tint */}
        {insights.verify_in_session.length > 0 && (
          <Section
            title="Verify in session"
            tone="sage"
            count={insights.verify_in_session.length}
          >
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "grid",
                gap: 4,
              }}
            >
              {insights.verify_in_session.map((v, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "#41513a",
                  }}
                >
                  {v}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* COACH NOTES — inline editable, save on blur */}
        <div style={{ display: "grid", gap: 4 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--fm-text-tertiary)",
              }}
            >
              Coach notes for AI
            </label>
            {savedFlash && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--fm-primary)",
                  fontWeight: 600,
                }}
              >
                💾 Saved
              </span>
            )}
            {savingNote && !savedFlash && (
              <span
                style={{ fontSize: 10, color: "var(--fm-text-tertiary)" }}
              >
                Saving…
              </span>
            )}
          </div>
          <textarea
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            onBlur={handleSaveCoachNotes}
            rows={4}
            placeholder="e.g. 'B12 and ferritin are in the uploaded report — don't ask me to order them' or 'She's already tried magnesium, didn't help'. These notes override the AI on the next regenerate AND flow into every downstream call (assess / rework / menu / sanity check)."
            style={{
              width: "100%",
              fontSize: 12,
              padding: 8,
              border: "1px solid var(--fm-border-light)",
              borderRadius: 4,
              fontFamily: "inherit",
              resize: "vertical",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
            }}
          />
          <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={pending}
              title="Apply these notes and regenerate the AI insights"
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "5px 10px",
                background: "var(--fm-primary)",
                color: "#fff",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? "Regenerating…" : "🔁 Regenerate with notes"}
            </button>
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              Notes save on blur. Click regenerate to apply them.
            </span>
          </div>
        </div>
      </div>
    </FmPanel>
  );
}

// ── Internal sub-components ───────────────────────────────────────────────────

interface SectionProps {
  title: string;
  tone: "rose" | "indigo" | "sage" | "neutral";
  count: number;
  children: React.ReactNode;
}

function Section({ title, tone, count, children }: SectionProps) {
  const palette: Record<SectionProps["tone"], { bg: string; ink: string; bar: string }> = {
    rose: { bg: "rgba(176,70,70,0.07)", ink: "#8a3a3a", bar: "#b04646" },
    indigo: { bg: "rgba(75,90,160,0.07)", ink: "#3a4a85", bar: "#6271a8" },
    sage: { bg: "rgba(118,140,98,0.08)", ink: "#41513a", bar: "#7a8e6e" },
    neutral: { bg: "var(--fm-bg-warm)", ink: "var(--fm-text-primary)", bar: "var(--fm-border)" },
  };
  const c = palette[tone];

  return (
    <details open style={{ marginBottom: 0 }}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: c.ink,
          padding: "4px 0",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 3,
            height: 14,
            background: c.bar,
            borderRadius: 2,
          }}
        />
        <span>{title}</span>
        <span
          style={{
            background: c.bar,
            color: "#fff",
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 8,
            fontWeight: 700,
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {count}
        </span>
      </summary>
      <div
        style={{
          marginTop: 6,
          padding: "8px 10px",
          background: c.bg,
          borderLeft: `3px solid ${c.bar}`,
          borderRadius: 4,
        }}
      >
        {children}
      </div>
    </details>
  );
}
