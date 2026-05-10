"use client";

/**
 * GeneticReportPanel — upload genetic / SNP test PDF (mapmygenome,
 * genomepatri, MedGenome, etc.), parse via Sonnet tool-use, and surface
 * extracted SNPs + clinical implications + FM recommendations.
 *
 * Same shape as FunctionalTestPanel — collapsible upload trigger, lists
 * prior parsed reports below.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  parseGeneticReportAction,
  loadGeneticReportsAction,
  assessReworkBenefitAction,
  type GeneticReportResult,
  type GeneticSnp,
} from "@/app/clients/actions";
import { uploadFileAction } from "@/app/assess/actions";

interface Props {
  clientId: string;
}

const ZYG_LABEL: Record<GeneticSnp["zygosity"], { label: string; color: string }> = {
  homozygous_risk: { label: "Homozygous (++)",   color: "bg-red-50 text-red-700 border-red-200" },
  heterozygous:    { label: "Heterozygous (+/-)", color: "bg-amber-50 text-amber-700 border-amber-200" },
  homozygous_wild: { label: "Wild-type (--)",    color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  unknown:         { label: "Unknown",           color: "bg-slate-50 text-slate-600 border-slate-200" },
};

export function GeneticReportPanel({ clientId }: Props) {
  const [reports, setReports] = useState<GeneticReportResult[]>([]);
  const [open, setOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadGeneticReportsAction(clientId).then((r) => {
      if (!alive) return;
      setReports(r.reports);
    });
    return () => { alive = false; };
  }, [clientId]);

  const refresh = async () => {
    const r = await loadGeneticReportsAction(clientId);
    setReports(r.reports);
  };

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    try {
      const fd = new FormData();
      fd.append("client_id", clientId);
      fd.append("file", file);
      const filePath = await uploadFileAction(fd);
      startTransition(async () => {
        const result = await parseGeneticReportAction(clientId, filePath);
        if (!result.ok) {
          setParseError(result.error ?? "Parse failed");
          toast.error(`Parse failed: ${(result.error ?? "").slice(0, 80)}`);
        } else {
          const snpCount = result.snps?.length ?? 0;
          toast.success(`✅ Genetic report parsed — ${snpCount} SNPs extracted`);
          await refresh();

          // Fire-and-forget AI rework assessment.
          const flaggedSnps = (result.snps ?? [])
            .filter((s) => s.zygosity === "homozygous_risk" || s.zygosity === "heterozygous")
            .slice(0, 6)
            .map((s) => `${s.gene} ${s.variant ?? ""} ${s.zygosity}`.trim())
            .join(", ");
          void assessReworkBenefitAction({
            clientId,
            triggeredBy: "genetic_report",
            eventSummary: `Genetic report: ${result.summary ?? ""}${flaggedSnps ? ` | SNPs: ${flaggedSnps}` : ""}`,
          });
        }
        setIsParsing(false);
      });
    } catch (e) {
      setParseError(String(e));
      setIsParsing(false);
    }
  };

  const hasAny = reports.length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          🧬 Genetic / SNP reports
          {hasAny && (
            <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-violet-100 text-violet-700">
              {reports.length}
            </span>
          )}
        </h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-2 py-1 rounded border hover:bg-muted"
        >
          {open ? "Hide" : "+ Upload report"}
        </button>
      </div>

      {open && (
        <div className="space-y-2 rounded border-2 border-dashed border-violet-200 bg-violet-50/30 p-3">
          <p className="text-xs text-muted-foreground">
            Upload PDF from mapmygenome, genomepatri, MedGenome, dnalabsindia, or any genetic / SNP panel.
            Sonnet extracts gene · variant · genotype · clinical implication · FM recommendation.
          </p>
          <input
            type="file"
            accept="application/pdf"
            disabled={isParsing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
            className="text-xs"
          />
          {isParsing && <p className="text-xs text-violet-700">⏳ Parsing — Sonnet may take 1-2 min on a long report…</p>}
          {parseError && <p className="text-xs text-red-600">{parseError}</p>}
        </div>
      )}

      {hasAny && (
        <ul className="space-y-2">
          {reports.map((r) => {
            const fp = r.file_path ?? "";
            const isExpanded = expandedFile === fp;
            const flagCount = (r.snps ?? []).filter((s) => s.zygosity === "homozygous_risk" || s.zygosity === "heterozygous").length;
            return (
              <li key={fp} className="rounded border bg-card text-xs">
                <button
                  onClick={() => setExpandedFile(isExpanded ? null : fp)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/40"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">🧬 Genetic report · {r.test_date ?? "—"}</p>
                    <p className="text-muted-foreground line-clamp-1">{r.summary}</p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 shrink-0">
                    {r.snps?.length ?? 0} SNPs · {flagCount} flagged
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t pt-3">
                    {/* Clinical implications */}
                    {(r.clinical_implications?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Clinical implications</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {r.clinical_implications!.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* FM recommendations */}
                    {(r.fm_recommendations?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">FM recommendations</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {r.fm_recommendations!.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* SNP table */}
                    {(r.snps?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">SNPs ({r.snps!.length})</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] border-collapse">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="text-left py-1 pr-2 font-medium">Gene · Variant</th>
                                <th className="text-left py-1 pr-2 font-medium">Genotype</th>
                                <th className="text-left py-1 pr-2 font-medium">Zygosity</th>
                                <th className="text-left py-1 font-medium">FM relevance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.snps!.map((s, i) => {
                                const zyg = ZYG_LABEL[s.zygosity];
                                return (
                                  <tr key={i} className="border-b border-muted/40 align-top">
                                    <td className="py-1.5 pr-2 font-mono">
                                      <span className="font-semibold">{s.gene}</span>
                                      {s.variant && <span className="text-muted-foreground"> · {s.variant}</span>}
                                      {s.rsid && <div className="text-muted-foreground">{s.rsid}</div>}
                                    </td>
                                    <td className="py-1.5 pr-2 font-mono">{s.genotype}</td>
                                    <td className="py-1.5 pr-2">
                                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${zyg.color}`}>
                                        {zyg.label}
                                      </span>
                                    </td>
                                    <td className="py-1.5">
                                      <p>{s.fm_relevance}</p>
                                      <p className="text-muted-foreground italic mt-0.5">{s.implication}</p>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {/* Flagged drivers */}
                    {(r.flagged_drivers?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.flagged_drivers!.map((d) => (
                          <span key={d} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
