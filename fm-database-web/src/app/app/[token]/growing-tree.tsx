"use client";

/**
 * GrowingTree — the client companion app's procedural tree hero.
 *
 * A thin React wrapper over the DOM renderer (growing-tree-engine.ts). It derives
 * the deterministic TreeState from real app data (weeks-on-plan + today's daily
 * check-ins), mounts the engine into a ref'd host <div> inside a useEffect, and
 * calls update() when the props change. All the drawing lives in the engine; the
 * engine is browser-only and only ever runs here, so SSR never touches it.
 *
 * No controls, no slider — the tree is driven entirely by the client's data.
 */

import { useEffect, useRef } from "react";
import { deriveTreeState } from "./growing-tree-state";
import { mountGrowingTree, type GrowingTreeHandle } from "./growing-tree-engine";

export function GrowingTree({
  week,
  totalWeeks,
  dailyDone,
  dailyTotal,
  streak = 0,
  bonusBlossoms = 0,
  bonusFruit = 0,
  size = 480,
}: {
  week: number;
  totalWeeks: number;
  dailyDone: number;
  dailyTotal: number;
  /** Consecutive-day logging streak — feeds the engine's birds/chicks. */
  streak?: number;
  /** Milestone blossoms (symptom-score wins) — extra flowers on top of stage. */
  bonusBlossoms?: number;
  /** Milestone fruit (completed check-ins) — extra fruit on top of stage. */
  bonusFruit?: number;
  /** Max render width in px (the SVG is fluid; this caps + centres the hero). */
  size?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GrowingTreeHandle | null>(null);

  // Night after 6pm local — derived from the client's own clock at render time.
  const night = typeof Date !== "undefined" ? new Date().getHours() >= 18 : false;
  const state = deriveTreeState({ week, totalWeeks, dailyDone, dailyTotal, streak, blossoms: bonusBlossoms, fruit: bonusFruit, night });

  // Mount once; tear down on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountGrowingTree(host, state);
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // Mount is intentionally one-shot; prop-driven updates flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the tree only when a field the engine actually uses changes.
  // deriveTreeState() returns a fresh object every render, so keying the effect on
  // the object identity would rebuild the whole canopy on every render. Key on a
  // stable primitive signature instead — update() fires only on a real change.
  const sig = `${state.week}|${state.totalWeeks}|${state.night ? 1 : 0}|${state.dailyDone}|${state.dailyTotal}|${state.streak}|${state.extraLeaves}|${state.blossoms}|${state.fruit}`;
  useEffect(() => {
    handleRef.current?.update(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (
    <div style={{ width: "100%", maxWidth: size, margin: "0 auto" }}>
      <div ref={hostRef} className="ot-tree-host" />
    </div>
  );
}
