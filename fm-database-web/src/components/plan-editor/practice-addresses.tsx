"use client";

/**
 * What is this practice here to work on?
 *
 * Freeform practices are deliberately not catalogue entities, so nothing joins
 * "Abhyanga — warm sesame oil self-massage" to `hpa-axis-dysregulation`. That
 * gap was invisible until staging arrived and had to decide which three
 * practices a client meets on day one: with no link, the only signal left was
 * the order the coach happened to type them in.
 *
 * The options are the PLAN'S OWN drivers and topics, in the plan's own order —
 * not the whole catalogue. A practice can only be here for something this plan
 * already says is going on, and a free slug picker would invite tagging against
 * a driver the plan never hypothesised.
 *
 * Rank is shown on every chip because it is the thing that acts: driver 1 is
 * what the foundation should be built from, and a coach tagging a practice
 * "constipation" deserves to see that it sits seventh.
 */

import type { PlanPriorities } from "@/lib/fmdb/practice-phasing";
import { priorityRank, UNRANKED } from "@/lib/fmdb/practice-phasing";

/**
 * Every slug this plan ranks, best first, with a human label for each.
 *
 * De-duplicated, because a slug legitimately appears in two bands: Hariharan's
 * plan names `hpa-axis-dysregulation` as both driver 1 and a primary topic. The
 * first occurrence wins, which is also the better rank, so the chip says
 * "driver 1" rather than "primary" — and the coach isn't offered the same thing
 * twice with two different apparent priorities.
 */
export function priorityOptions(p: PlanPriorities): { slug: string; band: string }[] {
  const all = [
    ...p.drivers.map((slug, i) => ({ slug, band: `driver ${i + 1}` })),
    ...p.primaryTopics.map((slug) => ({ slug, band: "primary" })),
    ...p.contributingTopics.map((slug) => ({ slug, band: "contributing" })),
  ];
  const seen = new Set<string>();
  return all.filter(({ slug }) => (seen.has(slug) ? false : (seen.add(slug), true)));
}

const pretty = (slug: string) => slug.replace(/-/g, " ");

export function PracticeAddresses({
  value,
  priorities,
  locked = false,
  onChange,
}: {
  value?: string[];
  priorities: PlanPriorities;
  locked?: boolean;
  onChange: (next: string[]) => void;
}) {
  const options = priorityOptions(priorities);
  // A plan with no drivers and no topics has nothing to tag against — showing
  // an empty picker would just be noise in every row.
  if (options.length === 0) return null;

  const on = new Set(value ?? []);
  const rank = priorityRank(value, priorities);

  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ fontSize: 10.5, color: "var(--fm-muted)", marginBottom: 4 }}>
        Works on
        {rank !== UNRANKED && (
          <span style={{ marginLeft: 6, color: rank < priorities.drivers.length ? "#3a4d41" : "var(--fm-muted)" }}>
            · ranks #{rank + 1} on this plan
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {options.map(({ slug, band }) => {
          const active = on.has(slug);
          return (
            <button
              key={slug}
              type="button"
              disabled={locked}
              title={band}
              onClick={() =>
                onChange(
                  active ? (value ?? []).filter((s) => s !== slug) : [...(value ?? []), slug],
                )
              }
              style={{
                fontSize: 10.5, padding: "2px 7px", borderRadius: 999, cursor: locked ? "default" : "pointer",
                border: `1px solid ${active ? "rgba(74,97,82,.5)" : "var(--fm-line)"}`,
                background: active ? "rgba(74,97,82,.12)" : "#fff",
                color: active ? "#3a4d41" : "var(--fm-muted)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {pretty(slug)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
