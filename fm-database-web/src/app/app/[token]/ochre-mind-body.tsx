"use client";

/* ======================================================================
   The Ochre Tree — one mind-body entry point on Today

   Replaces the stack of four launch cards (breathing, EFT, sleep, somatic)
   with a single "How are you feeling right now?" card. The client picks a
   state, not a technique — she shouldn't have to know that tapping is for
   heaviness and a wind-down is for a racing mind.

   The routing lives in mind-body-routing.ts and is pure, so it can be tested
   without a browser. This file is presentation only.

   A practice the coach linked specifically (a catalogue somatic practice,
   resolved by slug) keeps its own line below the card — it's the one thing
   here chosen FOR this client, and folding it into the chips would bury it.
   ====================================================================== */

import { useState } from "react";

import type { AppMindBodyRead, AppSomatic } from "@/lib/fmdb/somatic";
import { Icon, useOchre } from "./ochre-context";
import { routableFeelings, type Available, type FeelingKey, type Route } from "./mind-body-routing";

const ICON_FOR: Record<Route["kind"], string> = {
  breath: "breath",
  sleep: "moon",
  eft: "heart",
  somatic: "sprout",
};

export function MindBodyEntryCard({
  have,
  onOpen,
}: {
  have: Available;
  onOpen: (route: Route) => void;
}) {
  const [picked, setPicked] = useState<FeelingKey | null>(null);
  const options = routableFeelings(have);

  // Nothing prescribed and nothing unlocked — no card at all rather than an
  // empty question the client can't answer.
  if (options.length === 0) return null;

  const active = options.find((o) => o.feeling.key === picked) ?? null;

  return (
    <div className="mbe">
      <div className="mbe-kicker">
        <Icon name="sparkle" size={13} /> Mind &amp; body
      </div>
      <h3 className="mbe-q">How are you feeling right now?</h3>

      <div className="mbe-chips">
        {options.map(({ feeling }) => {
          const on = feeling.key === picked;
          return (
            <button
              key={feeling.key}
              type="button"
              className={`mbe-chip mbe-chip--${feeling.tone}${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => setPicked(on ? null : feeling.key)}
            >
              {feeling.label}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mbe-reply" role="status">
          <p className="mbe-reply-line">{active.feeling.reply}</p>
          <button type="button" className="mbe-go" onClick={() => onOpen(active.route)}>
            <Icon name={ICON_FOR[active.route.kind]} size={15} />
            {active.route.name}
            <Icon name="arrowRight" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- the coach's specific prescription, on its own line ---------------- */

/**
 * Deliberately lighter than the old dark launch card. It now sits under a
 * light entry card rather than beside a sage breathing card, so it no longer
 * needs a dark ground to hold its own — and Today is shorter for it.
 */
export function SomaticPrescribedLine({
  somatic,
  onStart,
  showKicker = true,
}: {
  somatic: AppSomatic;
  onStart: () => void;
  /** Only the first line is labelled — three repeats of the same kicker is
   *  the kind of bulk that made Today too long in the first place. */
  showKicker?: boolean;
}) {
  const mins = somatic.totalSeconds ? Math.max(1, Math.round(somatic.totalSeconds / 60)) : null;
  const meta = [somatic.when, mins ? `about ${mins} min` : "", somatic.bilateral ? "both sides" : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" className="mbe-rx" onClick={onStart}>
      <span className="mbe-rx-dot" aria-hidden="true" />
      <span className="mbe-rx-body">
        {showKicker && <span className="mbe-rx-kicker">Chosen for you</span>}
        <span className="mbe-rx-title">{somatic.name}</span>
        <span className="mbe-rx-meta">{meta}</span>
      </span>
      <span className="mbe-rx-go">
        <Icon name="play" size={13} /> Start
      </span>
    </button>
  );
}

/* ---- the mind-body connection ------------------------------------------ */

/**
 * The aha moment: for the condition the client actually lives with, the
 * emotional pattern the book associates with it, a kinder way to hold it, one
 * question to sit with — and then a DOABLE way through, their practice.
 *
 * Structured as a reveal, not a wall: collapsed cards showing only the
 * condition's evocative title; tapping one unfolds the reading. The unfold IS
 * the moment, so nothing inside it competes — one insight per screen.
 *
 * The single failure mode this layer guards against is an ASSOCIATION being
 * read as a CAUSE ("my grief gave me fibroids"). The framing line is therefore
 * not decoration, and the roots shown are only ever from `general` maps, whose
 * source notes are themselves hedged. Do not sharpen either into a claim.
 */
export function MindBodyReadsSection({
  reads,
  onStart,
}: {
  reads: AppMindBodyRead[];
  onStart: (practiceId: string) => void;
}) {
  const coachFirst = useOchre().coach.name.split(" ")[0];
  // the first read is the client's first-listed condition — open the door
  const [openTitle, setOpenTitle] = useState<string | null>(reads[0]?.title ?? null);
  if (!reads.length) return null;

  const pretty = (slug: string) =>
    slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="mbr">
      <p className="mbr-intro">
        The body often carries what the mind is still working through. These are
        invitations to notice — never an explanation for why something happened.
      </p>
      {reads.map((r) => {
        const open = openTitle === r.title;
        return (
          <div key={r.title} className={"mbr-card" + (open ? " open" : "")}>
            <button
              type="button"
              className="mbr-head"
              aria-expanded={open}
              onClick={() => setOpenTitle(open ? null : r.title)}
            >
              <h4 className="mbr-title">{r.title}</h4>
              <span className="mbr-chev" aria-hidden="true">{open ? "−" : "+"}</span>
            </button>

            {open && (
              <div className="mbr-body">
                {r.roots.length > 0 && (
                  <>
                    <span className="mbr-sub">What your body may be saying</span>
                    {r.roots.map((root) => (
                      <p key={root.pattern} className="mbr-root">
                        <strong>{root.pattern}.</strong> {root.note}
                      </p>
                    ))}
                  </>
                )}

                <span className="mbr-sub">A kinder way to hold it</span>
                <p className="mbr-reframe">{r.reframe}</p>

                {r.question && (
                  <p className="mbr-q">
                    <span className="mbr-q-mark" aria-hidden="true">
                      <Icon name="sparkle" size={12} />
                    </span>
                    {r.question}
                  </p>
                )}

                {r.practice ? (
                  <>
                    <span className="mbr-sub">A doable way through</span>
                    <button
                      type="button"
                      className="mbr-go"
                      onClick={() => onStart(r.practice!.practiceId)}
                    >
                      <Icon name="play" size={13} />
                      {r.practice.name}
                      <span className="mbr-go-sub">a few minutes, guided</span>
                    </button>
                  </>
                ) : (
                  r.practiceSlug && (
                    <p className="mbr-ask">
                      There&apos;s a practice for this — <strong>{pretty(r.practiceSlug)}</strong>.
                      Ask {coachFirst} about adding it to your plan.
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
