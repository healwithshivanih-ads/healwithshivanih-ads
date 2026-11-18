"use client";

/**
 * The first-day start card and "How this app works".
 *
 * Replaces the old first-run tour for the new front: nothing opens by itself.
 * The card sits on Home before the plan starts and on its first day; the same
 * one-minute explainer is always under Everything.
 *
 * Only what is built is described. The ask box and the rest of the Everything
 * tab get their own lines here when their build steps land.
 */

import { SqCard, SqNavRow } from "./sq-ui";

export function SqStartCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="sq-card sq-welcome">
      <h3>Your plan is ready</h3>
      <p>One small thing before your first day. It takes about a minute.</p>
      <div className="sq-list">
        <SqNavRow title="See how the app works" note="One minute" onOpen={onOpen} />
      </div>
    </section>
  );
}

const POINTS: [string, string][] = [
  ["Today shows one thing: what is next", "Tap Done when you have had it. The next thing takes its place."],
  ["Supplements have their own tap", "When one goes with a meal, it sits on that meal's card. Tap it when you have taken it."],
  ["Your whole day is one tap away", "Every meal and supplement with its own tick. Tap a tick again to clear it."],
  ["The ring at the top", "It grows as the weeks of your programme pass."],
];

export function SqStartSheet() {
  return (
    <>
      <SqCard>
        <div className="sq-list">
          {POINTS.map(([title, note]) => (
            <div key={title} className="sq-li">
              <span className="sq-li-body">
                <b>{title}</b>
                <small>{note}</small>
              </span>
            </div>
          ))}
        </div>
      </SqCard>
      <SqCard title="Do I have to do all of it?">
        <p className="sq-sub">
          Start with the meals. Add the supplements as they arrive. The practices are there when you are ready for them.
        </p>
      </SqCard>
    </>
  );
}
