"use client";

/**
 * LiverDetoxAdvisoryCard — coach-side flash on the Overview > Insights tab
 * when the submitted intake shows a liver / biotransformation (detox) burden
 * pattern (detectLiverDetoxAdvisory). Sits alongside the AI intake-insights
 * card so the "AI's read" surfaces detox burden reliably (deterministic,
 * zero API cost) on top of whatever the Haiku narrative says.
 *
 * Read-only: signals grouped by Phase route, a framework note, a link to the
 * liver-detox assessment mind map, and a dismiss-for-now. No server action —
 * this is a thinking aid, it changes nothing on disk.
 *
 * Self-hides when the detector returns null.
 */

import { useState } from "react";
import Link from "next/link";
import { FmPanel, FmChip } from "@/components/fm";
import type {
  LiverDetoxAdvisory,
  DetoxGroup,
} from "@/lib/fmdb/liver-detox-advisory";

interface Props {
  advisory: LiverDetoxAdvisory | null;
}

const GROUP_META: Record<
  DetoxGroup,
  { title: string; blurb: string; ink: string }
> = {
  load: {
    title: "Load (↑ Phase I demand)",
    blurb: "What the liver is being asked to process",
    ink: "#92400e",
  },
  upstream: {
    title: "Reactive sensitivity (Phase I → II)",
    blurb: "Intermediates outpacing conjugation",
    ink: "#3a4a85",
  },
  elimination: {
    title: "Elimination (Phase III)",
    blurb: "The exit route — start here when it's backed up",
    ink: "#8a3a3a",
  },
};

const GROUP_ORDER: DetoxGroup[] = ["elimination", "upstream", "load"];

export function LiverDetoxAdvisoryCard({ advisory }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (!advisory || dismissed) return null;

  const byGroup = (g: DetoxGroup) =>
    advisory.signals.filter((s) => s.group === g);

  return (
    <FmPanel
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>🫀 Possible liver-detox burden</span>
          <FmChip tone="warning">
            {advisory.signal_count} signal{advisory.signal_count === 1 ? "" : "s"}
          </FmChip>
        </span>
      }
      tight
    >
      <div
        style={{
          background: "rgba(180, 120, 60, 0.07)",
          border: "1px solid rgba(180, 120, 60, 0.30)",
          borderRadius: 6,
          padding: "10px 12px",
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--fm-text-primary)",
          }}
        >
          {advisory.headline}. This is a <strong>pattern to explore</strong>,
          not a diagnosis or a confirmed stage — the questionnaire can&apos;t
          phase detox on its own. Support elimination and the basics first
          (bowels, hydration, sleep, protein + sulfur foods); confirm a phase
          only with functional labs.
        </div>

        {GROUP_ORDER.filter((g) => advisory.group_counts[g] > 0).map((g) => {
          const meta = GROUP_META[g];
          const items = byGroup(g);
          return (
            <div key={g} style={{ display: "grid", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: meta.ink,
                  }}
                >
                  {meta.title}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                  }}
                >
                  {meta.blurb}
                </span>
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 0,
                  display: "grid",
                  gap: 6,
                  listStyle: "none",
                }}
              >
                {items.map((s, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12,
                      lineHeight: 1.45,
                      background: "var(--fm-surface)",
                      border: "1px solid var(--fm-border-light)",
                      borderRadius: 4,
                      padding: "6px 9px",
                      display: "grid",
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ color: meta.ink, fontSize: 12 }}>
                        {s.label}
                      </strong>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--fm-text-tertiary)",
                          fontStyle: "italic",
                        }}
                      >
                        {s.source_field}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--fm-text-secondary)",
                        fontStyle: "italic",
                      }}
                    >
                      &ldquo;{s.evidence}&rdquo;
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/mindmap/liver-detox-assessment"
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
              border: "1px solid var(--fm-border)",
              borderRadius: 5,
              textDecoration: "none",
            }}
            title="The phase-by-phase liver-detox assessment mind map"
          >
            🗺 Open the detox assessment map
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              background: "transparent",
              color: "var(--fm-text-tertiary)",
              border: "1px solid var(--fm-border)",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="Hide until next reload — won't change anything on disk"
          >
            Dismiss for now
          </button>
        </div>

        <div
          style={{
            fontSize: 10.5,
            color: "var(--fm-text-tertiary)",
            lineHeight: 1.45,
            borderTop: "1px solid var(--fm-border-light)",
            paddingTop: 6,
          }}
        >
          🟡 For the client&apos;s clinician: DUTCH (oestrogen Phase I/II
          metabolites), organic acids, liver enzymes, glutathione markers. 🔴
          No aggressive detoxes / cleanses — VitaOne&apos;s own rule. Support
          the basics within coaching scope.
        </div>
      </div>
    </FmPanel>
  );
}
