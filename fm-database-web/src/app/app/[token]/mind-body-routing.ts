/**
 * "How are you feeling right now?" — one entry point instead of four cards.
 *
 * Today was stacking a launch card per guided technique (breathing, EFT, sleep
 * wind-down, somatic reset). Four cards is a menu, and a menu asks the client
 * to diagnose herself before she can do anything. It also made an already-long
 * screen longer.
 *
 * So the card asks how she feels and routes. The mapping is deliberate:
 *
 *   on edge         → breathing        slow the system down first
 *   mind won't stop → sleep wind-down  put the day down
 *   holding it in   → somatic release  the body is braced; let it go
 *   heavy           → tapping          move what's sitting on her
 *   steady          → breathing        hold her there
 *   good today      → breathing        let the body remember it
 *
 * Two of the six are positive on purpose (the coach's call): a client who feels
 * fine should still find something here, and it must not be a rescue practice
 * dressed up as a reward.
 *
 * Every chip must land somewhere. A technique can be absent (not prescribed) or
 * withheld (mind-body drip hasn't unlocked it yet), so each feeling carries a
 * preference ORDER and resolves to the first available. A chip that resolves to
 * nothing is not rendered at all — a dead chip is worse than no chip.
 *
 * The reply lines never name the technique. Fallback would otherwise make them
 * lie ("let's put the day down" over a tapping session).
 */

import type { AppSomatic, MotionShape } from "@/lib/fmdb/somatic";

export type TargetKind = "breath" | "sleep" | "eft" | "somatic";

export type FeelingKey = "edge" | "racing" | "holding" | "heavy" | "steady" | "good";

export interface Feeling {
  key: FeelingKey;
  /** Client-facing, first person, the coach's words. */
  label: string;
  /** Shown once the chip is tapped. Warm, and technique-agnostic. */
  reply: string;
  /** Preference order; first available wins. */
  prefer: readonly TargetKind[];
  /** Positive states get a lighter visual treatment. */
  tone: "reach" | "settled";
}

export const FEELINGS: readonly Feeling[] = [
  {
    key: "edge",
    label: "I'm on edge",
    reply: "Let's take the edge off — a few minutes is enough.",
    prefer: ["breath", "somatic", "eft", "sleep"],
    tone: "reach",
  },
  {
    key: "racing",
    label: "My mind won't stop",
    reply: "Let's put the day down and let your mind slow.",
    prefer: ["sleep", "breath", "somatic", "eft"],
    tone: "reach",
  },
  {
    key: "holding",
    label: "I'm holding it all in",
    reply: "Let's let some of that go.",
    prefer: ["somatic", "breath", "eft", "sleep"],
    tone: "reach",
  },
  {
    key: "heavy",
    label: "I feel heavy",
    reply: "Let's lighten it a little.",
    prefer: ["eft", "somatic", "breath", "sleep"],
    tone: "reach",
  },
  {
    key: "steady",
    label: "I feel steady",
    reply: "Lovely — let's hold you right there.",
    prefer: ["breath", "somatic", "eft", "sleep"],
    tone: "settled",
  },
  {
    key: "good",
    label: "I feel good today",
    reply: "Wonderful. Let's lock that in.",
    prefer: ["breath", "somatic", "eft", "sleep"],
    tone: "settled",
  },
] as const;

/** What the client actually has available right now. */
export interface Available {
  breath: { name: string } | null;
  eft: { name: string } | null;
  sleep: { name: string } | null;
  /** Every prescribed somatic, in plan order. */
  somatic: readonly AppSomatic[];
}

export interface Route {
  kind: TargetKind;
  /** Button label — names the actual practice, so a fallback stays honest. */
  name: string;
  /** Which somatic to open. Only set when kind === "somatic". */
  somatic?: AppSomatic;
}

/**
 * Shapes that mean "a held thing lets go", best answer to "I'm holding it in".
 * Ordered — a true release beats a pressure that merely ends.
 */
const LETTING_GO: readonly MotionShape[] = ["release", "load_release", "sustained_pressure"];

/** Pick the somatic that best answers this feeling; falls back to the first. */
function pickSomatic(somatic: readonly AppSomatic[], key: FeelingKey): AppSomatic | null {
  if (!somatic.length) return null;
  if (key === "holding") {
    for (const shape of LETTING_GO) {
      const hit = somatic.find((s) => s.shape === shape);
      if (hit) return hit;
    }
  }
  return somatic[0];
}

/** Resolve one feeling to something the client can actually start, or null. */
export function routeFeeling(feeling: Feeling, have: Available): Route | null {
  for (const kind of feeling.prefer) {
    if (kind === "somatic") {
      const s = pickSomatic(have.somatic, feeling.key);
      if (s) return { kind, name: s.name, somatic: s };
      continue;
    }
    const t = have[kind];
    if (t) return { kind, name: t.name };
  }
  return null;
}

/** The chips worth showing — those that resolve to a real practice. */
export function routableFeelings(have: Available): { feeling: Feeling; route: Route }[] {
  return FEELINGS.map((feeling) => {
    const route = routeFeeling(feeling, have);
    return route ? { feeling, route } : null;
  }).filter((x): x is { feeling: Feeling; route: Route } => x !== null);
}
