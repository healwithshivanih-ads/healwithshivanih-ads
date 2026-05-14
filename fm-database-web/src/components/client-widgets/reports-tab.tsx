"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  uploadReportAction,
  getClientReportsAction,
  deleteReportAction,
} from "@/lib/server-actions/clients";
import type { ExternalReport } from "@/lib/server-actions/clients";

// ── Report type catalogue ─────────────────────────────────────────────────────

interface ReportTypeDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  accepts: string;
  note?: string;
}

const REPORT_TYPES: ReportTypeDef[] = [
  {
    id: "gi_stool_test",
    label: "GI Stool Analysis",
    icon: "🦠",
    description: "GI-MAP, Genova GI Effects, Doctor's Data CSA, Viome",
    accepts: ".pdf",
    note: "Upload the full report PDF",
  },
  {
    id: "dutch_test",
    label: "DUTCH Hormone Panel",
    icon: "🧪",
    description: "DUTCH Complete, DUTCH Plus, DUTCH Cycle Mapping",
    accepts: ".pdf",
    note: "Upload the results PDF (not the collection instructions)",
  },
  {
    id: "dexa_scan",
    label: "DEXA Scan",
    icon: "🦴",
    description: "Bone density + body composition scan report",
    accepts: ".pdf",
  },
  {
    id: "genetic_test",
    label: "Genetic / Nutrigenomic Report",
    icon: "🧬",
    description: "23andMe interpretation, MTHFR panel, nutrigenomic report",
    accepts: ".pdf,.txt,.csv",
    note: "Upload the interpreted report PDF. Raw SNP data (.txt/.csv) is also accepted — only FM-relevant variants will be extracted.",
  },
  {
    id: "food_sensitivity",
    label: "Food Sensitivity Panel",
    icon: "🌾",
    description: "IgG/IgE food panel, ALCAT, MRT, US BioTek",
    accepts: ".pdf",
  },
  {
    id: "organic_acids",
    label: "Organic Acids Test (OAT)",
    icon: "🔬",
    description: "Great Plains OAT, Genova Organix Comprehensive",
    accepts: ".pdf",
  },
  {
    id: "imaging",
    label: "Imaging / Radiology Report",
    icon: "📷",
    description: "MRI, CT, X-ray, ultrasound radiology report",
    accepts: ".pdf",
    note: "Upload the radiologist's report PDF, not the raw scan images",
  },
  {
    id: "other",
    label: "Other Report",
    icon: "📋",
    description: "Any other clinical or functional lab report",
    accepts: ".pdf,.png,.jpg,.jpeg",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function flagColor(flag: string | null | undefined) {
  if (!flag) return "";
  const f = flag.toString().toUpperCase();
  if (f === "H" || f === "HIGH") return "text-red-600 font-semibold";
  if (f === "L" || f === "LOW") return "text-blue-600 font-semibold";
  return "text-muted-foreground";
}

function formatDate(iso?: string | null) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return iso; }
}

// ── Extracted data renderer ───────────────────────────────────────────────────

function ExtractedValue({ label, obj }: { label: string; obj: unknown }) {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const val = o.value ?? o.genotype ?? o.level;
  if (val === null || val === undefined || val === "") return null;
  const flag = (o.flag ?? o.impact ?? o.classification) as string | null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}</span>
      <span className={flagColor(flag)}>
        {String(val)} {o.unit ? <span className="text-muted-foreground font-normal">{o.unit as string}</span> : null}
      </span>
      {flag && flag !== val && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          ["H","HIGH","high","significantly_reduced"].includes(flag) ? "bg-red-100 text-red-700" :
          ["L","LOW","low"].includes(flag) ? "bg-blue-100 text-blue-700" :
          "bg-muted text-muted-foreground"
        }`}>{flag}</span>
      )}
    </div>
  );
}

function ReportDataView({ report }: { report: ExternalReport }) {
  const [open, setOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const ex = report.extracted;

  if (!ex || Object.keys(ex).length === 0) {
    return <p className="text-xs text-muted-foreground italic">No structured data extracted.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Key findings */}
      {report.key_findings.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Key Findings</p>
          <ul className="space-y-1">
            {report.key_findings.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      {report.summary && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">{report.summary}</p>
      )}

      {/* Structured data toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <span>{open ? "▲" : "▼"}</span>
        <span>{open ? "Hide" : "Show"} detailed values</span>
      </button>

      {open && (
        <div className="space-y-4 border-t pt-3">
          {/* GI Stool */}
          {report.type === "gi_stool_test" && (
            <>
              {(ex.pathogens as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Pathogens</p>
                  <div className="space-y-0.5">
                    <ExtractedValue label="H. Pylori" obj={(ex.pathogens as Record<string, unknown>)?.h_pylori} />
                    <ExtractedValue label="C. diff" obj={(ex.pathogens as Record<string, unknown>)?.c_diff} />
                    <ExtractedValue label="E. coli" obj={(ex.pathogens as Record<string, unknown>)?.e_coli} />
                  </div>
                </div>
              )}
              {(ex.inflammation as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Inflammation</p>
                  <div className="space-y-0.5">
                    <ExtractedValue label="Calprotectin" obj={(ex.inflammation as Record<string, unknown>)?.calprotectin} />
                    <ExtractedValue label="Lactoferrin" obj={(ex.inflammation as Record<string, unknown>)?.lactoferrin} />
                    <ExtractedValue label="Lysozyme" obj={(ex.inflammation as Record<string, unknown>)?.lysozyme} />
                  </div>
                </div>
              )}
              {(ex.digestive_function as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Digestive Function</p>
                  <div className="space-y-0.5">
                    <ExtractedValue label="Pancreatic Elastase" obj={(ex.digestive_function as Record<string, unknown>)?.pancreatic_elastase} />
                    <ExtractedValue label="Secretory IgA" obj={(ex.digestive_function as Record<string, unknown>)?.secretory_iga} />
                    <ExtractedValue label="Short-chain FAs" obj={(ex.digestive_function as Record<string, unknown>)?.total_short_chain_fatty_acids} />
                  </div>
                </div>
              )}
              {(ex.intestinal_permeability as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Intestinal Permeability</p>
                  <div className="space-y-0.5">
                    <ExtractedValue label="Zonulin" obj={(ex.intestinal_permeability as Record<string, unknown>)?.zonulin} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* DUTCH */}
          {report.type === "dutch_test" && (
            <>
              {(ex.cortisol_pattern as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Cortisol Pattern</p>
                  <div className="space-y-0.5">
                    {["morning_car","waking","midday","afternoon","night"].map(k => (
                      <ExtractedValue key={k} label={k.replace(/_/g, " ")} obj={(ex.cortisol_pattern as Record<string, unknown>)?.[k]} />
                    ))}
                    {(ex.cortisol_pattern as Record<string, unknown>)?.overall_pattern != null && (
                      <div className="text-xs"><span className="text-muted-foreground">Pattern: </span>{String((ex.cortisol_pattern as Record<string, unknown>).overall_pattern)}</div>
                    )}
                  </div>
                </div>
              )}
              {(ex.estrogen as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Estrogen Metabolites</p>
                  <div className="space-y-0.5">
                    {["e1","e2","e3"].map(k => <ExtractedValue key={k} label={k.toUpperCase()} obj={(ex.estrogen as Record<string, unknown>)?.[k]} />)}
                    {(ex.estrogen as Record<string, unknown>)?.e1_metabolites != null && (
                      <>
                        {["2_oh_e1","4_oh_e1","16_oh_e1"].map(k => (
                          <ExtractedValue key={k} label={k.replace(/_/g," ")} obj={((ex.estrogen as Record<string, unknown>).e1_metabolites as Record<string, unknown>)?.[k]} />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
              {(ex.melatonin as Record<string, unknown>) && <ExtractedValue label="Melatonin" obj={ex.melatonin} />}
            </>
          )}

          {/* DEXA */}
          {report.type === "dexa_scan" && (
            <>
              {(ex.bone_density as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Bone Density (T-score)</p>
                  <div className="space-y-0.5">
                    {["lumbar_spine","femoral_neck","total_hip","forearm"].map(region => {
                      const r = (ex.bone_density as Record<string, unknown>)?.[region] as Record<string, unknown> | null;
                      if (!r) return null;
                      return (
                        <div key={region} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground min-w-[120px] capitalize">{region.replace(/_/g," ")}</span>
                          <span className={flagColor(r.classification as string)}>T: {String(r.t_score ?? "—")}</span>
                          {r.z_score !== null && r.z_score !== undefined && <span className="text-muted-foreground">Z: {String(r.z_score)}</span>}
                          {r.classification != null && <span className="text-[10px] text-muted-foreground">{String(r.classification)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {(ex.body_composition as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Body Composition</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {[
                      ["lean_mass_kg","Lean mass (kg)"],["lean_mass_pct","Lean mass %"],
                      ["fat_mass_kg","Fat mass (kg)"],["fat_mass_pct","Fat %"],
                      ["visceral_fat_area_cm2","Visceral fat (cm²)"],["android_gynoid_ratio","A/G ratio"],
                    ].map(([key, label]) => {
                      const val = (ex.body_composition as Record<string, unknown>)?.[key];
                      if (val === null || val === undefined) return null;
                      return (
                        <div key={key} className="flex gap-1 text-xs">
                          <span className="text-muted-foreground">{label}:</span>
                          <span>{String(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Genetic */}
          {report.type === "genetic_test" && (
            <>
              {(ex.methylation as Record<string, unknown>) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Methylation</p>
                  <div className="space-y-0.5">
                    {Object.entries(ex.methylation as Record<string, unknown>).map(([key, val]) => (
                      <ExtractedValue key={key} label={key.replace(/_/g," ").toUpperCase()} obj={val} />
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(ex.key_actionable_variants) && ex.key_actionable_variants.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Actionable Variants</p>
                  <ul className="space-y-0.5">{(ex.key_actionable_variants as string[]).map((v, i) => (
                    <li key={i} className="text-xs">• {v}</li>
                  ))}</ul>
                </div>
              )}
            </>
          )}

          {/* Food sensitivity */}
          {report.type === "food_sensitivity" && (ex.reactive_foods as Record<string, unknown>) && (
            <div className="space-y-2">
              {(["severe_high","moderate","mild_borderline"] as const).map(level => {
                const foods = (ex.reactive_foods as Record<string, string[]>)?.[level] ?? [];
                if (!foods.length) return null;
                return (
                  <div key={level}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-muted-foreground">{level.replace(/_/g," ")}</p>
                    <div className="flex flex-wrap gap-1">
                      {foods.map((f) => (
                        <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          level === "severe_high" ? "bg-red-50 border-red-200 text-red-700" :
                          level === "moderate" ? "bg-amber-50 border-amber-200 text-amber-700" :
                          "bg-muted text-muted-foreground border-border"
                        }`}>{f}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Imaging */}
          {report.type === "imaging" && (
            <div className="space-y-2">
              {(ex.impression as string) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Impression</p>
                  <p className="text-xs">{ex.impression as string}</p>
                </div>
              )}
              {Array.isArray(ex.recommendations) && (ex.recommendations as string[]).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Recommendations</p>
                  <ul>{(ex.recommendations as string[]).map((r, i) => <li key={i} className="text-xs">• {r}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Organic Acids */}
          {report.type === "organic_acids" && (
            <div className="grid grid-cols-2 gap-4">
              {(["yeast_fungal","bacterial_dysbiosis","mitochondrial_function","oxidative_stress"] as const).map(section => {
                const s = ex[section] as Record<string, unknown> | null;
                if (!s) return null;
                return (
                  <div key={section}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{section.replace(/_/g," ")}</p>
                    {s.overall_elevation != null && <p className="text-xs">{String(s.overall_elevation)}</p>}
                    {s.overall != null && <p className="text-xs">{String(s.overall)}</p>}
                    {Array.isArray(s.notable_markers) && (s.notable_markers as {marker: string; value: string; flag: string}[]).slice(0,3).map((m) => (
                      <div key={m.marker} className="flex gap-1 text-xs">
                        <span className="text-muted-foreground">{m.marker}:</span>
                        <span className={flagColor(m.flag)}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Raw JSON fallback toggle */}
          <div className="border-t pt-2">
            <button onClick={() => setRawOpen(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground">
              {rawOpen ? "▲ Hide" : "▼ Show"} raw JSON
            </button>
            {rawOpen && (
              <pre className="mt-1 text-[10px] bg-muted/30 rounded p-2 max-h-48 overflow-auto font-mono whitespace-pre-wrap">
                {JSON.stringify(ex, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload form ───────────────────────────────────────────────────────────────

function UploadReportForm({ clientId, onUploaded }: { clientId: string; onUploaded: (r: ExternalReport) => void }) {
  const [selectedType, setSelectedType] = useState<ReportTypeDef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dateOfReport, setDateOfReport] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const def = selectedType ?? null;

  const handleUpload = useCallback(async () => {
    if (!file || !def) { toast.error("Select a report type and file"); return; }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      const result = await uploadReportAction({
        clientId,
        reportType: def.id,
        fileDataBase64: b64,
        fileName: file.name,
        dateOfReport: dateOfReport || undefined,
      });
      if (result.ok && result.report) {
        toast.success(`${def.label} uploaded and extracted`);
        onUploaded(result.report);
        setFile(null);
        setSelectedType(null);
        setDateOfReport("");
        if (fileRef.current) fileRef.current.value = "";
      } else {
        toast.error(result.error ?? "Upload failed");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setUploading(false);
    }
  }, [file, def, clientId, dateOfReport, onUploaded]);

  return (
    <div className="space-y-4">
      {/* Report type grid */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Select report type</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.id}
              onClick={() => { setSelectedType(rt); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className={`text-left rounded-lg border p-3 text-sm transition-colors hover:border-primary/40 ${
                selectedType?.id === rt.id
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-background"
              }`}
            >
              <div className="text-xl mb-1">{rt.icon}</div>
              <div className="font-medium text-xs leading-tight">{rt.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{rt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* File + date inputs */}
      {def && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-2xl">{def.icon}</span>
            <div>
              <p className="text-sm font-semibold">{def.label}</p>
              {def.note && <p className="text-xs text-amber-700 mt-0.5">{def.note}</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Report file <span className="text-red-500">*</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept={def.accepts}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:bg-background file:text-sm file:font-medium hover:file:bg-muted/50 cursor-pointer"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Accepts: {def.accepts}</p>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Date of report
              </label>
              <input
                type="date"
                value={dateOfReport}
                onChange={(e) => setDateOfReport(e.target.value)}
                className="rounded-lg border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {file && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>📄</span>
              <span>{file.name}</span>
              <span>({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            className="font-semibold px-5 py-2 rounded-lg text-sm text-white bg-primary hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            {uploading ? "⏳ Uploading & extracting… (Haiku)" : "⬆️ Upload & extract"}
          </button>
          {uploading && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Running AI extraction with Claude Haiku — usually 15–45 seconds…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Report card ───────────────────────────────────────────────────────────────

function ReportCard({ report, clientId, onDeleted }: { report: ExternalReport; clientId: string; onDeleted: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete this ${report.display_type}? This cannot be undone.`)) return;
    setDeleting(true);
    const r = await deleteReportAction(clientId, report.id);
    if (r.ok) {
      toast.success("Report deleted");
      onDeleted(report.id);
    } else {
      toast.error(r.error ?? "Delete failed");
      setDeleting(false);
    }
  }, [clientId, report, onDeleted]);

  const TYPE_ICONS: Record<string, string> = {
    gi_stool_test: "🦠", dutch_test: "🧪", dexa_scan: "🦴", genetic_test: "🧬",
    food_sensitivity: "🌾", organic_acids: "🔬", imaging: "📷", other: "📋",
  };

  return (
    <div className="rounded-xl border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <span className="text-2xl shrink-0">{TYPE_ICONS[report.type] ?? "📋"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{report.display_type}</span>
            {report.lab_name && (
              <Badge variant="outline" className="text-[10px]">{report.lab_name}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
            {report.date_of_report && <span>Report date: {formatDate(report.date_of_report)}</span>}
            <span>Uploaded: {formatDate(report.date_uploaded)}</span>
            <span className="font-mono">{report.file_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-2.5 py-1 rounded border hover:bg-muted/50 transition-colors"
          >
            {expanded ? "▲ Collapse" : "▼ View data"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "…" : "✕"}
          </button>
        </div>
      </div>

      {/* Summary preview */}
      {!expanded && report.summary && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-muted-foreground line-clamp-2 italic">{report.summary}</p>
          {report.key_findings.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {report.key_findings.slice(0, 2).map((f, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 line-clamp-1">
                  {f.length > 60 ? f.slice(0, 60) + "…" : f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded data */}
      {expanded && (
        <div className="border-t px-4 py-3">
          <ReportDataView report={report} />
        </div>
      )}
    </div>
  );
}

// ── Main tab component ────────────────────────────────────────────────────────

export function ReportsTab({ clientId }: { clientId: string }) {
  const [reports, setReports] = useState<ExternalReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    getClientReportsAction(clientId).then((r) => {
      setReports(r);
      setLoading(false);
    });
  }, [clientId]);

  const handleUploaded = (report: ExternalReport) => {
    setReports((prev) => [report, ...prev]);
    setShowUpload(false);
  };

  const handleDeleted = (id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">External Reports</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload functional lab reports, imaging, DUTCH, DEXA, genetic and food sensitivity results.
            AI extracts key values automatically using Claude Haiku.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(v => !v)}
          className="shrink-0 font-semibold px-4 py-2 rounded-lg text-sm border border-primary text-primary hover:bg-primary/5 transition-colors"
        >
          {showUpload ? "✕ Cancel" : "+ Upload report"}
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Upload & Extract</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadReportForm clientId={clientId} onUploaded={handleUploaded} />
          </CardContent>
        </Card>
      )}

      {/* Report list */}
      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading reports…</p>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm font-medium text-muted-foreground">No external reports uploaded yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload GI stool analysis, DUTCH panels, DEXA scans, genetic reports, food sensitivity tests,
            imaging reports or any other functional lab result.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            Upload first report →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              clientId={clientId}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
