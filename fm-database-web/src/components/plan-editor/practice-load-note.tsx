"use client";

/**
 * How much of the client's day this plan is asking for — shown BEFORE publish.
 *
 * A 14-practice plan reached a real client and nobody noticed, because the
 * only number on screen was the practice count and every practice looked the
 * same size. "Hibiscus tea" and "abhyanga — 20 minutes of self-massage" are
 * both one row.
 *
 * So this counts the expensive thing instead: DEDICATED STOPPED MOMENTS. And
 * it names them, because the classification is a heuristic over free text and
 * the coach needs to be able to disagree at a glance. A number she cannot
 * audit would be worse than no number.
 *
 * It never blocks publishing. It is a second pair of eyes, not a gate.
 */

import { looksAppGuided } from "@/lib/fmdb/app-guided";
import { classifyPractice, practiceLoad } from "@/lib/fmdb/practice-load";
import { normalisePhase, phaseOpensAtWeek, priorityRank, seedPhases, UNRANKED, type PlanPriorities } from "@/lib/fmdb/practice-phasing";

const TONE = {
  comfortable: { bg: "rgba(74,97,82,.08)", line: "rgba(74,97,82,.28)", fg: "#3a4d41", icon: "🌱" },
  full: { bg: "rgba(169,101,31,.09)", line: "rgba(169,101,31,.3)", fg: "#8c5318", icon: "🌗" },
  heavy: { bg: "rgba(163,45,45,.07)", line: "rgba(163,45,45,.28)", fg: "#a32d2d", icon: "🌑" },
} as const;

export function PracticeLoadNote({
  practices,
  totalWeeks = 12,
  priorities,
  onStage,
  locked = false,
}: {
  practices: { name?: string; details?: string; somatic_practice?: string | null; phase?: number | null; addresses?: string[]; exercises?: unknown[] }[];
  /** plan_period_weeks — decides which week each phase lands on */
  totalWeeks?: number;
  /** the plan's ranked drivers + topics — what the foundation is chosen by */
  priorities?: PlanPriorities;
  /** apply a suggested phase to every practice, in order. Omit to hide the offer. */
  onStage?: (phases: number[]) => void;
  locked?: boolean;
}) {
  const rows = practices ?? [];
  const load = practiceLoad(
    rows.map((p) => ({
      name: p.name ?? "",
      guided: looksAppGuided(p.name ?? "", p.details ?? "", p.somatic_practice),
      // An exercise session is a stopped moment by structure, not by wording —
      // see classifyPractice. Without this the most dedicated row on the plan
      // counts as free.
      exercises: p.exercises,
    })),
  );
  if (load.total === 0) return null;
  const tone = TONE[load.verdict];

  // What the client actually meets on day one, once staging is taken into
  // account — which is the number that matters and was previously invisible.
  const phases = rows.map((p) => normalisePhase(p.phase));
  const maxPhase = phases.reduce((m, n) => Math.max(m, n), 1);
  const staged = maxPhase > 1;
  // Does the plan actually rank these practices, or is staging still falling
  // back to the order they were typed in? Drives both the warning below and
  // what the button honestly promises.
  const untagged = priorities
    ? rows.filter((p) => priorityRank(p.addresses, priorities) === UNRANKED).length
    : rows.length;
  const byRootCause = untagged < rows.length;
  const dayOne = practiceLoad(
    rows
      .filter((_, i) => phases[i] === 1)
      .map((p) => ({ name: p.name ?? "", guided: looksAppGuided(p.name ?? "", p.details ?? "", p.somatic_practice) })),
  );

  return (
    <div
      style={{
        border: `1px solid ${tone.line}`, background: tone.bg, borderRadius: 10,
        padding: "10px 12px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.55,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span aria-hidden="true">{tone.icon}</span>
        <span style={{ color: tone.fg, fontWeight: 600 }}>{load.headline}</span>
      </div>

      {load.dedicated.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--fm-muted)", marginBottom: 4 }}>
            Needs its own moment{load.guidedCount > 0 ? ` · ${load.guidedCount} guided in the app` : ""}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {load.dedicated.map((p) => (
              <span
                key={p.name}
                title={p.guided ? "Opens a guided session in the app" : undefined}
                style={{
                  fontSize: 11, padding: "3px 8px", borderRadius: 999,
                  background: "#fff", border: "1px solid var(--fm-line)", color: "var(--fm-ink, #262219)",
                }}
              >
                {p.guided ? "▷ " : ""}
                {p.name.split("—")[0].trim().slice(0, 38)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Once phases exist, the headline above describes the WHOLE plan while
          the client only meets phase 1 — so say what day one is, or the note
          keeps warning about a load nobody is actually being handed. */}
      {staged && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: tone.fg }}>
          Staged over {maxPhase} phases — the client starts with {dayOne.total}{" "}
          {dayOne.total === 1 ? "practice" : "practices"}, {dayOne.dedicated.length}{" "}
          needing their own moment. The rest open on{" "}
          {Array.from({ length: maxPhase - 1 }, (_, k) =>
            `week ${phaseOpensAtWeek(k + 2, totalWeeks)}`,
          ).join(", ")}
          .
        </div>
      )}

      {load.verdict !== "comfortable" && !staged && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--fm-muted)" }}>
          The cheap ones — teas, meal timing, a bedtime anchor — cost almost nothing;
          it is the stopped moments that compete. Staging the extra stopped moments
          usually buys more adherence than leaving all of them in.
        </div>
      )}

      {/* Partial tagging is the state worth naming. Untagged practices sort
          AFTER every tagged one, so a plan where two rows are tagged and nine
          are not will stage almost entirely on those two — which looks like a
          bug unless you know it isn't. */}
      {untagged > 0 && untagged < load.total && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#8c5318" }}>
          {untagged} of {load.total} practices have no driver set. Staging puts those
          last — tag them, or clear the rest, so the whole plan is ordered the same way.
        </div>
      )}

      {/* Offered, never applied automatically. The heuristic can be wrong
          about which practice matters most, and the coach's ordering is the
          only thing that knows. */}
      {onStage && !locked && !staged && load.verdict !== "comfortable" && (
        <button
          type="button"
          onClick={() => onStage(seedPhases(
            rows.map((p) => ({
              name: p.name ?? "",
              guided: looksAppGuided(p.name ?? "", p.details ?? "", p.somatic_practice),
              addresses: p.addresses,
            })),
            classifyPractice,
            3,
            2,
            priorities,
          ))}
          style={{
            marginTop: 10, fontSize: 11.5, padding: "5px 10px", borderRadius: 8,
            border: `1px solid ${tone.line}`, background: "#fff", color: tone.fg,
            cursor: "pointer", fontWeight: 600,
          }}
        >
          {byRootCause
            ? "Stage this plan — day one built from the top-ranked driver"
            : "Stage this plan — keep the first 3 stopped moments, open the rest later"}
        </button>
      )}
    </div>
  );
}
