"use client";

/**
 * Your results — body age and lab numbers the coach has released, each with
 * a plain tag. What a number means is the coach's to say: this screen adds no
 * interpretation, only "within", "above" or "below" the usual range.
 */

import type { AppResults } from "@/lib/fmdb/released-results";
import { TAG_WORDS } from "@/lib/fmdb/released-results";
import { SqCard } from "./sq-ui";

const fmt = (ymd: string): string => {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

export function SqResultsSheet({ results, onAsk }: { results: AppResults | null; onAsk: () => void }) {
  if (!results) {
    return (
      <SqCard>
        <p className="sq-sub">Your coach goes through your results with you first, so the first time you see them is together. They appear here after that.</p>
        <div className="sq-row-btns">
          <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={onAsk}>
            Ask my coach
          </button>
        </div>
      </SqCard>
    );
  }
  const ba = results.bodyAge;
  return (
    <>
      {results.note && (
        <section className="sq-soft">
          <b>From your coach.</b> {results.note}
        </section>
      )}
      {ba && (
        <SqCard title="Your body age">
          <p className="sq-big-num">{ba.value} years</p>
          <p className="sq-sub">
            {ba.calendarAge !== null ? `You were ${ba.calendarAge} at the test` : "From your blood test"}
            {ba.date ? ` on ${fmt(ba.date)}` : ""}. One test is a snapshot; it is measured again at your recheck.
          </p>
        </SqCard>
      )}
      {results.groups.map((g) => (
        <SqCard key={g.system} title={g.system}>
          <ul className="sq-res">
            {g.rows.map((r) => (
              <li key={r.name} className={`sq-res-${r.tag}`}>
                <div className="sq-res-top">
                  <span className="sq-res-name">{r.name}</span>
                  <span className="sq-res-val">
                    {r.value} {r.unit}
                  </span>
                </div>
                <span className="sq-res-tag">
                  {TAG_WORDS[r.tag]}
                  {r.range ? ` (${r.range})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </SqCard>
      ))}
      {results.groups.length === 0 && !ba && (
        <SqCard>
          <p className="sq-sub">No results are on file yet.</p>
        </SqCard>
      )}
      <section className="sq-soft">
        What these mean for you, and what to do about them, is for your coach.{" "}
        <button type="button" className="sq-link" onClick={onAsk}>
          Ask my coach
        </button>
      </section>
    </>
  );
}
