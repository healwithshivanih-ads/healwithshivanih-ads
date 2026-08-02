/**
 * Phase arc NAMES — the one place the programme's three arcs are named, read
 * by both the client app's ribbon and the coach's plan timeline.
 *
 * They used to be two hardcoded lists (client-app.ts said Foundation /
 * Rebalance / Sustain, plan-editor-phases.ts said Foundation / Build /
 * Maintenance), which is how the coach screen and the client screen ended up
 * able to disagree — the same failure mode as the recheck date living in three
 * places. One list, one continuation rule.
 *
 * A CONTINUING plan never opens on "Foundation": that client already built the
 * foundation. Nidhi Jain's phase 3 opened by telling her she was "in the
 * Foundation phase now. Calming the system and building a steady daily rhythm"
 * — twelve weeks and a 0.8-point HbA1c drop after she started.
 *
 * Names are chosen to read naturally in the app's coach line,
 * "you're in the {name} phase now".
 */

export interface PhaseArcCopy {
  name: string;
  /** Client-facing one-liner. Coach surfaces show the name only. */
  note: string;
}

/** First plan with this coach — the client really is starting. */
export const FIRST_PLAN_ARCS: readonly PhaseArcCopy[] = [
  { name: "Foundation", note: "Calming the system and building a steady daily rhythm." },
  { name: "Rebalance", note: "Settling blood sugar and stress hormones." },
  { name: "Sustain", note: "Anchoring it all as a way of living." },
] as const;

/** Any later phase — she is carrying on, not starting over. */
export const CONTINUING_ARCS: readonly PhaseArcCopy[] = [
  { name: "Momentum", note: "Carrying on from where the last phase left you — nothing starts over." },
  { name: "Deepening", note: "Pressing on what moved, holding what has steadied." },
  { name: "Sustain", note: "Anchoring it all as a way of living." },
] as const;

/** The three arcs for this plan. `continued` comes from programme-tenure. */
export function phaseArcs(continued: boolean): readonly PhaseArcCopy[] {
  return continued ? CONTINUING_ARCS : FIRST_PLAN_ARCS;
}

/**
 * Programme label for the app header. A first plan is a reset; a later phase
 * is not — telling a returning client she is on "your 12-week reset" erases
 * the work behind her.
 */
export function programmeLabel(
  totalWeeks: number,
  phaseNumber: number,
  continued: boolean,
  goalsLabel?: string,
): string {
  const weeks = Math.max(1, Math.round(totalWeeks || 12));
  if (continued) return `Phase ${Math.max(2, phaseNumber)} · your next ${weeks} weeks`;
  return goalsLabel ? `${goalsLabel} reset` : `Your ${weeks}-week reset`;
}
