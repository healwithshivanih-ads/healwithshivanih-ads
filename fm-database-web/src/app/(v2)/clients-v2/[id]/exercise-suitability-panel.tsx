/**
 * ExerciseSuitabilityPanel — the exercise catalogue, screened against THIS client.
 *
 * COACH-SIDE ONLY, and a nudge rather than a decision. Nothing here edits a
 * plan; the panel says what the catalogue and the record together imply, and
 * the coach decides. That asymmetry is deliberate — the same reason
 * `foods_to_avoid` stays hers alone.
 *
 * Blocked entries are listed FIRST and in full. The instinct is to hide them
 * (they are the ones she can't use), but the whole value of a screen is
 * knowing what came off the table and why — a silently shorter list reads as
 * "the catalogue is thin" rather than "this client has a reason".
 *
 * Server component: it reads the catalogue off disk and screens in place. No
 * action, no fetch, no loading state.
 */

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { exerciseFigureSvg } from "@/lib/fmdb/exercise-figure";
import { screenAll, summarise, type ExerciseVerdict, type Verdict } from "@/lib/fmdb/exercise-screen";
import { loadAllOfKind } from "@/lib/fmdb/loader";
import type { Exercise } from "@/lib/fmdb/types";

const VERDICT_META: Record<Verdict, { label: string; blurb: string; tone: string }> = {
  blocked: {
    label: "Off the table",
    blurb: "A hard block matched this client's record. Don't prescribe these.",
    tone: "border-destructive/40 bg-destructive/5",
  },
  caution: {
    label: "Use with the modification",
    blurb: "Fine to prescribe, but the modification is part of the prescription.",
    tone: "border-amber-500/40 bg-amber-500/5",
  },
  watch: {
    label: "Look twice",
    blurb:
      "Nothing in the entry matched — this comes from the client's own record " +
      "(a tagged pain region, or a balance demand high for their age). No authored " +
      "modification behind it; your call.",
    tone: "border-sky-500/40 bg-sky-500/5",
  },
  clear: {
    label: "Clear",
    blurb: "Nothing fired against this record.",
    tone: "border-border bg-card",
  },
};

function VerdictRow({ v, ex }: { v: ExerciseVerdict; ex?: Exercise }) {
  return (
    <div className="flex gap-3 items-start py-2 border-t first:border-t-0">
      {/* Same figure builder as the catalogue detail page — at this size it only
          has to separate seated work from standing at a glance, which is exactly
          the distinction that matters when scanning for a frail client. */}
      <div
        className="w-8 shrink-0 text-muted-foreground pt-0.5"
        aria-hidden
        dangerouslySetInnerHTML={{
          __html: exerciseFigureSvg({
            position: ex?.position,
            jointStress: ex?.joint_stress,
            balanceDemand: ex?.balance_demand,
            title: v.client_name,
          }),
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            href={`/catalogue/exercises/${v.slug}`}
            className="text-sm font-semibold hover:underline"
          >
            {v.client_name}
          </Link>
          <span className="text-[11px] text-muted-foreground">{v.modality.replace(/_/g, " ")}</span>
          {v.start_level && (
            <Badge variant="outline" className="text-[10px]">
              start at {v.start_level}
              {v.start_reason === "start supported" ? " · supported" : ""}
            </Badge>
          )}
        </div>
        {v.notes.map((n, i) => (
          <p key={i} className="text-xs text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{n.label}</span> — {n.detail}
            {n.modification && (
              <>
                {" "}
                <span className="font-semibold text-foreground">Instead:</span> {n.modification}
              </>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

export async function ExerciseSuitabilityPanel({
  client,
}: {
  client: Record<string, unknown>;
}) {
  const exercises = await loadAllOfKind<Exercise>("exercises");
  if (exercises.length === 0) return null;

  const verdicts = screenAll(exercises as unknown as Parameters<typeof screenAll>[0], client);
  const counts = summarise(verdicts);
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));

  const groups: Verdict[] = ["blocked", "caution", "watch", "clear"];
  const firstName = String(client.display_name ?? "").split(" ")[0] || "this client";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {groups.map((g) =>
          counts[g] > 0 ? (
            <Badge key={g} variant={g === "blocked" ? "destructive" : "secondary"}>
              {counts[g]} {VERDICT_META[g].label.toLowerCase()}
            </Badge>
          ) : null,
        )}
        <span className="text-muted-foreground">
          screened against {firstName}&apos;s conditions, medications, body map and age
        </span>
      </div>

      {groups.map((g) => {
        const rows = verdicts.filter((v) => v.verdict === g);
        if (rows.length === 0) return null;
        const meta = VERDICT_META[g];
        return (
          <div key={g} className={`rounded-lg border p-3 ${meta.tone}`}>
            <div className="text-xs font-semibold uppercase tracking-wide">{meta.label}</div>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1">{meta.blurb}</p>
            {/* `clear` collapses — it is the long tail and carries no reasoning. */}
            {g === "clear" ? (
              <details>
                <summary className="text-xs cursor-pointer text-muted-foreground">
                  {rows.length} exercise{rows.length > 1 ? "s" : ""} with nothing flagged
                </summary>
                <div className="mt-1">
                  {rows.map((v) => (
                    <VerdictRow key={v.slug} v={v} ex={bySlug.get(v.slug)} />
                  ))}
                </div>
              </details>
            ) : (
              rows.map((v) => <VerdictRow key={v.slug} v={v} ex={bySlug.get(v.slug)} />)
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        A screen, not a prescription — it reads what is on the record and can only be as
        good as that. Nothing here has been added to a plan.
      </p>
    </div>
  );
}
