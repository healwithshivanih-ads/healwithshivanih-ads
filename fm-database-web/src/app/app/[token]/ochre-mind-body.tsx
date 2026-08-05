"use client";

/* ======================================================================
   The Ochre Tree — one mind-body entry point on Today

   A single quiet "Find a reset" line, collapsed by default. The earlier
   version was an always-open "How are you feeling right now?" card — a
   question the app asked unprompted, every day, whose answer went nowhere
   (2026-08-05 audit: fourth of five feeling-asks in the app). Now the
   client opens it when SHE wants a reset; the chips only appear on request.
   She still picks a state, not a technique — she shouldn't have to know
   that tapping is for heaviness and a wind-down is for a racing mind.

   The routing lives in mind-body-routing.ts and is pure, so it can be tested
   without a browser. This file is presentation only.

   A practice the coach linked specifically (a catalogue somatic practice,
   resolved by slug) keeps its own line above — it's the one thing here
   chosen FOR this client, and folding it into the chips would bury it.
   ====================================================================== */

import { useState } from "react";

import type { AppMindBodyRead } from "@/lib/fmdb/somatic";
import { Icon, useOchre } from "./ochre-context";
import { RootsMotif } from "./mind-body-motif";
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
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<FeelingKey | null>(null);
  const options = routableFeelings(have);

  // Nothing prescribed and nothing unlocked — no line at all rather than a
  // door that opens onto an empty room.
  if (options.length === 0) return null;

  // Collapsed: one quiet line, no question. The client opts in.
  if (!open) {
    return (
      <button type="button" className="mbe-link" onClick={() => setOpen(true)}>
        <Icon name="sparkle" size={13} />
        <span>Rough moment? Find a reset</span>
        <Icon name="arrowRight" size={14} />
      </button>
    );
  }

  const active = options.find((o) => o.feeling.key === picked) ?? null;

  return (
    <div className="mbe">
      <div className="mbe-kicker">
        <Icon name="sparkle" size={13} /> Mind &amp; body
      </div>
      <p className="mbe-lead">Tap what&apos;s closest — the right reset finds you.</p>

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
  withheldCount,
  onStart,
}: {
  reads: AppMindBodyRead[];
  /** matched conditions held back as sensitive/coach-only */
  withheldCount: number;
  onStart: (practiceId: string) => void;
}) {
  const coachFirst = useOchre().coach.name.split(" ")[0];
  // the first read is the client's first-listed condition — open the door
  const [openTitle, setOpenTitle] = useState<string | null>(reads[0]?.title ?? null);
  if (!reads.length) return null;

  return (
    <div className="mbr">
      <p className="mbr-intro">
        The body often carries what the mind is still working through. This is
        <strong> food for thought, not a diagnosis</strong>{" "}— take what lands,
        leave what doesn&apos;t, and bring anything it stirs up to {coachFirst}.
      </p>
      <RootsMotif />
      {withheldCount > 0 && (
        /* Without this the section reads as the whole picture when it is the
           part that is safe to read alone. The withheld ones are the named
           diagnoses, so staying silent would quietly imply the opposite of
           the truth — and the right channel for them is a conversation. */
        <p className="mbr-held">
          <Icon name="message" size={13} />
          <span>
            {withheldCount === 1
              ? "There's one more that's better talked through together — "
              : `There are ${withheldCount} more that are better talked through together — `}
            {coachFirst} has these for your next session.
          </span>
        </p>
      )}
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

                {r.practice && (
                  <>
                    <span className="mbr-sub">A doable way through</span>
                    <button
                      type="button"
                      className="mbr-go"
                      onClick={() => onStart(r.practice!.practiceId)}
                    >
                      <Icon name="play" size={13} />
                      {r.practice.name}
                      <span className="mbr-go-sub">
                        {r.prescribed ? "on your plan · guided" : "try it whenever · guided"}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
