"use client";

/**
 * MedicationImpactPanel — auto-flags drug-nutrient depletions for the
 * client's current medications. Renders ONLY when at least one match is
 * found (no panel for clients on no meds, no panel when nothing matches
 * the catalogue).
 *
 * Mounted in the client Overview tab, above Five Pillars / Lab refs.
 */

import { useEffect, useState } from "react";
import {
  checkMedicationImpactsAction,
  type MedicationImpactMatch,
} from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  severe: "bg-red-100 text-red-900 border-red-300",
  moderate: "bg-amber-50 text-amber-900 border-amber-200",
  mild: "bg-slate-50 text-slate-700 border-slate-200",
};

export function MedicationImpactPanel({ clientId }: Props) {
  const [matches, setMatches] = useState<MedicationImpactMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void checkMedicationImpactsAction(clientId).then((r) => {
      if (!alive) return;
      setMatches(r.ok ? r.matches : []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [clientId]);

  if (loading || !matches || matches.length === 0) return null;

  const totalDepletions = matches.reduce((acc, m) => acc + (m.depletes?.length ?? 0), 0);
  const severeCount = matches.reduce(
    (acc, m) => acc + (m.depletes ?? []).filter((d) => d.severity === "severe").length,
    0,
  );

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-amber-900">
            💊 Medication impact
          </span>
          <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
            {matches.length} drug{matches.length !== 1 ? "s" : ""} · {totalDepletions} nutrient flag{totalDepletions !== 1 ? "s" : ""}
            {severeCount > 0 && <span className="ml-1.5 text-red-700">· {severeCount} severe</span>}
          </span>
        </div>
        <span className="text-xs text-amber-800">{open ? "▲" : "▼"}</span>
      </button>

      {!open && (
        <p className="text-xs text-amber-900/80">
          Click to review drug-nutrient depletions, monitoring labs, and timing separations for this client&apos;s medications.
        </p>
      )}

      {open && (
        <div className="space-y-3 pt-2">
          {matches.map((m) => (
            <div key={m.drug_slug} className="rounded-lg border bg-background p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <a
                    href={`/catalogue/drug_depletions/${m.drug_slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-sm hover:underline"
                  >
                    {m.drug_name}
                  </a>
                  {m.drug_class && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      {m.drug_class.replace(/_/g, " ")}
                    </span>
                  )}
                  {m.evidence_tier && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {m.evidence_tier.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground italic">
                  client says: &ldquo;{m.client_med_text}&rdquo;
                </span>
              </div>

              {m.summary && (
                <p className="text-xs leading-relaxed text-foreground/80">
                  {m.summary}
                </p>
              )}

              {m.depletes && m.depletes.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Depletes
                  </div>
                  <ul className="space-y-1.5">
                    {m.depletes.map((d, i) => (
                      <li
                        key={i}
                        className={`rounded-md border px-2 py-1.5 ${
                          SEVERITY_COLOR[d.severity ?? "moderate"] ?? SEVERITY_COLOR.moderate
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{d.nutrient}</span>
                          {d.severity && (
                            <span className="text-[10px] uppercase tracking-wide font-medium">
                              {d.severity}
                            </span>
                          )}
                        </div>
                        {d.mechanism && (
                          <p className="text-xs leading-snug mt-0.5 opacity-90">{d.mechanism}</p>
                        )}
                        {d.monitoring_recommendation && (
                          <p className="text-xs leading-snug mt-1">
                            <span className="font-medium">📊 Monitor: </span>
                            {d.monitoring_recommendation}
                          </p>
                        )}
                        {d.typical_supplement_dose && (
                          <p className="text-xs leading-snug mt-0.5">
                            <span className="font-medium">💊 Suggest: </span>
                            {d.typical_supplement_dose}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {m.timing_separations && m.timing_separations.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Timing separations
                  </div>
                  <ul className="text-xs space-y-0.5 list-disc list-inside text-foreground/80">
                    {m.timing_separations.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}

              {m.monitoring_labs && m.monitoring_labs.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Monitoring labs
                  </div>
                  <ul className="text-xs space-y-0.5 list-disc list-inside text-foreground/80">
                    {m.monitoring_labs.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}

              {m.contraindicated_supplements && m.contraindicated_supplements.length > 0 && (
                <div className="rounded-md bg-red-50 border border-red-200 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-red-900 font-semibold mb-0.5">
                    ⚠ Avoid these supplements
                  </div>
                  <p className="text-xs text-red-800">
                    {m.contraindicated_supplements.join(", ")}
                  </p>
                </div>
              )}

              {m.coach_notes && (
                <div className="rounded-md bg-muted/40 border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">
                    Coach notes
                  </div>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                    {m.coach_notes}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
