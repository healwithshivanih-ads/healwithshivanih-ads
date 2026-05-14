"use client";

/**
 * PregnancySafetyPanel — auto-flag supplements in active plans that
 * conflict with the client's pregnancy / lactation status.
 *
 * Renders ONLY when:
 *   - client.pregnancy_status indicates an active state (TTC / pregnant /
 *     lactating)
 *   AND
 *   - at least one supplement in their active plan has caution /
 *     contraindicated / unknown safety
 *
 * Mounted on Client Overview alongside Medication Impact.
 */

import { useEffect, useState } from "react";
import {
  checkPregnancySafetyAction,
  type PregnancySafetyFlag,
  type PregnancySafetyResult,
} from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
}

const STATUS_LABEL: Record<string, string> = {
  trying_to_conceive: "🤍 Trying to conceive",
  pregnant_first_trimester: "🤰 Pregnant — Trimester 1",
  pregnant_second_trimester: "🤰 Pregnant — Trimester 2",
  pregnant_third_trimester: "🤰 Pregnant — Trimester 3",
  lactating: "🤱 Lactating",
};

const SAFETY_COLOR: Record<string, string> = {
  contraindicated: "bg-red-100 text-red-900 border-red-300",
  caution: "bg-amber-50 text-amber-900 border-amber-200",
  unknown: "bg-slate-50 text-slate-700 border-slate-200",
  likely_safe: "bg-emerald-50 text-emerald-800 border-emerald-200",
  safe: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

const SAFETY_LABEL: Record<string, string> = {
  contraindicated: "AVOID",
  caution: "Caution",
  unknown: "Unknown",
  likely_safe: "Likely safe",
  safe: "Safe",
};

export function PregnancySafetyPanel({ clientId }: Props) {
  const [data, setData] = useState<PregnancySafetyResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void checkPregnancySafetyAction(clientId).then((r) => {
      if (!alive) return;
      setData(r);
      // Auto-expand if there are contraindicated supps
      if (r.ok && r.flags.some((f) => f.pregnancy_safety === "contraindicated" || f.lactation_safety === "contraindicated")) {
        setOpen(true);
      }
    });
    return () => { alive = false; };
  }, [clientId]);

  if (!data || !data.ok || !data.isActiveStatus) return null;

  const contraindicated = data.flags.filter(
    (f) => f.pregnancy_safety === "contraindicated" || f.lactation_safety === "contraindicated",
  );
  const cautionOnly = data.flags.filter(
    (f) => f.pregnancy_safety !== "contraindicated" && f.lactation_safety !== "contraindicated",
  );
  const totalConcerns = data.flags.length + data.unknownSupplements.length;

  if (totalConcerns === 0) {
    return (
      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4">
        <span className="text-sm font-semibold text-emerald-900">
          {STATUS_LABEL[data.status ?? ""] ?? "Pregnancy / lactation status active"}
        </span>
        <p className="text-xs text-emerald-800/80 mt-1">
          ✓ All supplements in this client&apos;s active plan(s) are safe.
        </p>
      </div>
    );
  }

  const banner = contraindicated.length > 0
    ? "border-red-300 bg-red-50/60"
    : "border-amber-300 bg-amber-50/40";

  return (
    <div className={`rounded-xl border-2 p-4 space-y-2 ${banner}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-foreground">
            {STATUS_LABEL[data.status ?? ""] ?? "Pregnancy / lactation status"}
          </span>
          {contraindicated.length > 0 && (
            <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-900 border border-red-300">
              ⚠ {contraindicated.length} contraindicated
            </span>
          )}
          {cautionOnly.length > 0 && (
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
              {cautionOnly.length} caution
            </span>
          )}
          {data.unknownSupplements.length > 0 && (
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
              {data.unknownSupplements.length} unknown
            </span>
          )}
        </div>
        <span className="text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {!open && (
        <p className="text-xs">
          Click to review supplement safety overlay.
        </p>
      )}

      {open && (
        <div className="space-y-2 pt-2">
          {contraindicated.map((f) => <FlagCard key={`c-${f.supplement_slug}`} flag={f} />)}
          {cautionOnly.map((f) => <FlagCard key={`a-${f.supplement_slug}`} flag={f} />)}
          {data.unknownSupplements.map((f) => <FlagCard key={`u-${f.supplement_slug}`} flag={f} />)}
        </div>
      )}
    </div>
  );
}

function FlagCard({ flag }: { flag: PregnancySafetyFlag }) {
  const pregColor = SAFETY_COLOR[flag.pregnancy_safety] ?? SAFETY_COLOR.unknown;
  const lactColor = SAFETY_COLOR[flag.lactation_safety] ?? SAFETY_COLOR.unknown;
  return (
    <div className="rounded-lg border bg-background p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <a
          href={`/catalogue/supplements/${flag.supplement_slug}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-sm hover:underline"
        >
          {flag.supplement_name}
        </a>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${pregColor}`}>
            🤰 {SAFETY_LABEL[flag.pregnancy_safety] ?? flag.pregnancy_safety}
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${lactColor}`}>
            🤱 {SAFETY_LABEL[flag.lactation_safety] ?? flag.lactation_safety}
          </span>
        </div>
      </div>
      {flag.note && (
        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {flag.note}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        From plan:{" "}
        <a href={`/plans/${flag.source_plan_slug}`} className="hover:underline font-medium">
          {flag.source_plan_slug}
        </a>
      </p>
    </div>
  );
}
