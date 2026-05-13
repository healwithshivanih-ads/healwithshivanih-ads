"use client";

/**
 * V2TrackingCharts — longitudinal tracking surface on the v2 Sessions tab.
 *
 * Wraps four v1 tracking components in v2 FmPanel chrome:
 *   - 📈 Outcome progress       — symptom burden bar chart + Five Pillars deltas
 *   - 💊 Protocol adherence     — supplement/practice status grid across check-ins
 *   - 🧬 IFM trend              — 7-node IFM matrix over time (≥2 full sessions)
 *   - 📊 Lab comparison         — side-by-side two health_snapshots
 *
 * Each inner component returns null when its own data threshold isn't met,
 * so this wrapper renders an empty wrapper when nothing has anything to show.
 * The wrapper itself also short-circuits if there are 0 sessions.
 *
 * Design punchlist refs #16, #17, #18, #19 (CLIENT DETAIL → ANALYSE TAB,
 * "missing: everything ACROSS time").
 */

import { OutcomeProgressCard } from "@/app/clients/[id]/outcome-progress-card";
import { ProtocolAdherenceChart } from "@/app/clients/[id]/protocol-adherence-chart";
import { IFMTrend } from "@/app/clients/[id]/ifm-trend";
import { LabComparison } from "@/app/clients/[id]/lab-comparison";
import { FmPanel } from "@/components/fm";
import type { SessionSummary } from "@/app/assess/actions";
import type { Client } from "@/lib/fmdb/types";

export function V2TrackingCharts({
  clientId,
  client,
  sessions,
}: {
  clientId: string;
  client: Client;
  sessions: SessionSummary[];
}) {
  if (!sessions || sessions.length === 0) return null;

  // Decide which sections will produce content — keeps the grid empty
  // (and the wrapper hidden) when the client is too early in their journey.
  const fullCount = sessions.filter((s) => s.session_type === "intake").length;
  const checkInCount = sessions.filter((s) => s.session_type === "check_in").length;
  const snapshotCount = (client.health_snapshots ?? []).length;

  const showOutcome   = sessions.length >= 2;
  const showAdherence = checkInCount >= 1;
  const showIFM       = fullCount >= 2;
  const showLabs      = snapshotCount >= 2;

  if (!showOutcome && !showAdherence && !showIFM && !showLabs) return null;

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
        gap: 14,
        marginBottom: 14,
      }}
    >
      {showOutcome && (
        <FmPanel title="📈 Outcome progress" subtitle="Symptom burden + Five Pillars across sessions">
          <OutcomeProgressCard sessions={sessions} />
        </FmPanel>
      )}
      {showAdherence && (
        <FmPanel title="💊 Protocol adherence" subtitle="Supplements + practices across check-ins">
          <ProtocolAdherenceChart sessions={sessions} />
        </FmPanel>
      )}
      {showIFM && (
        <FmPanel title="🧬 IFM trend" subtitle="7-node functional matrix across full assessments">
          <IFMTrend clientId={clientId} sessions={sessions} />
        </FmPanel>
      )}
      {showLabs && (
        <FmPanel title="📊 Lab comparison" subtitle="Side-by-side two health snapshots">
          <LabComparison client={client} />
        </FmPanel>
      )}
    </section>
  );
}
