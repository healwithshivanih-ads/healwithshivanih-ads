"use client";

/**
 * SessionBriefModal — print-optimised one-pager for a single session.
 *
 * Triggered from each expanded session card in the Sessions tab history.
 * Clicking "🖨 Print" calls window.print(); the injected <style> hides
 * everything except #session-brief-content on print.
 */

import type { SessionSummary } from "@/app/assess/actions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripSessionTypeTag(text: string): string {
  // Strip [session_type: xxx] prefix and [source: xxx] prefix
  return text.replace(/^\[(?:session_type|source):[^\]]+\]\s*/i, "").trim();
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const SESSION_TYPE_LABELS: Record<string, string> = {
  full_assessment: "Full session",
  pre_intake: "Intake session",
  check_in: "Check-in",
  quick_note: "Quick Note",
  discovery_consultation: "Discovery consultation",
};

const PILLARS = [
  { key: "sleep_quality", label: "😴 Sleep",   max: 5, invert: false },
  { key: "stress_level",  label: "🧘 Stress",  max: 5, invert: true  },
  { key: "movement_days_per_week", label: "🏃 Movement", max: 7, invert: false },
  { key: "nutrition_quality", label: "🥗 Nutrition", max: 5, invert: false },
  { key: "connection_quality", label: "🤝 Connection", max: 5, invert: false },
] as const;

function pillarColor(score: number, max: number, invert: boolean): string {
  const pct = score / max;
  const good = invert ? pct <= 0.4 : pct >= 0.7;
  const mid  = invert ? pct <= 0.6 : pct >= 0.4;
  if (good) return "#059669";   // emerald
  if (mid)  return "#D97706";   // amber
  return "#DC2626";             // red
}

// ── Print CSS (injected once via <style>) ─────────────────────────────────────

const PRINT_CSS = `
@media print {
  body > * { display: none !important; }
  body > #session-brief-print-root { display: block !important; }
  #session-brief-print-root > * { display: block !important; }
  .brief-no-print { display: none !important; }
  .brief-modal-overlay { position: static !important; background: transparent !important; }
  .brief-modal-card {
    position: static !important;
    box-shadow: none !important;
    border: none !important;
    max-height: none !important;
    overflow: visible !important;
    max-width: 100% !important;
    border-radius: 0 !important;
    padding: 0 !important;
  }
  #session-brief-content {
    font-family: Georgia, serif !important;
    font-size: 11pt !important;
    line-height: 1.5 !important;
    color: #111 !important;
    padding: 20mm !important;
  }
  .brief-section-header {
    font-size: 8pt !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
    color: #555 !important;
    margin-bottom: 4pt !important;
    font-family: Arial, sans-serif !important;
  }
  .brief-header { page-break-after: avoid; }
  .brief-footer { color: #16a34a !important; }
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

interface SessionBriefModalProps {
  session: SessionSummary;
  clientName: string;
  onClose: () => void;
}

export function SessionBriefModal({ session, clientName, onClose }: SessionBriefModalProps) {
  const typeLabel = SESSION_TYPE_LABELS[session.session_type] ?? session.session_type;
  const formattedDate = formatDate(session.date);
  const headingDate = session.date ? `${typeLabel} — ${formattedDate}` : typeLabel;

  const cleanComplaints = session.presenting_complaints
    ? stripSessionTypeTag(session.presenting_complaints)
    : null;

  const drivers = session.likely_drivers ?? [];
  const supplements = session.supplement_suggestions ?? [];
  const labs = session.requested_labs ?? [];
  const fp = session.five_pillars;

  function handlePrint() {
    window.print();
  }

  return (
    <>
      {/* Inject print CSS once */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Overlay backdrop */}
      <div
        className="brief-modal-overlay fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        id="session-brief-print-root"
      >
        {/* Modal card */}
        <div
          className="brief-modal-card relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {/* Toolbar */}
          <div
            className="brief-no-print sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 border-b bg-white rounded-t-xl"
          >
            <span className="text-sm font-semibold text-gray-700">📄 Session brief</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "#2B2D42" }}
              >
                🖨 Print
              </button>
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-all"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* Brief content */}
          <div id="session-brief-content" className="px-6 py-5 space-y-5">

            {/* ── Header ── */}
            <div className="brief-header border-b-2 pb-3 space-y-0.5" style={{ borderColor: "#2B2D42" }}>
              <h1 className="text-lg font-bold" style={{ color: "#2B2D42", fontFamily: "Georgia, serif" }}>
                {clientName}
              </h1>
              <p className="text-sm" style={{ color: "#555" }}>{headingDate}</p>
            </div>

            {/* ── Presenting complaints ── */}
            {cleanComplaints && (
              <div className="space-y-1.5">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Presenting complaints / chief concerns
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {cleanComplaints}
                </p>
              </div>
            )}

            {/* ── AI analysis summary ── */}
            {session.synthesis_notes && (
              <div className="space-y-1.5">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  AI analysis summary
                </div>
                <p className="text-sm text-gray-700 italic leading-relaxed">
                  {session.synthesis_notes}
                </p>
              </div>
            )}

            {/* ── Key drivers ── */}
            {drivers.length > 0 && (
              <div className="space-y-1.5">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Key drivers
                </div>
                <ol className="list-decimal list-inside space-y-1">
                  {drivers.map((d, i) => {
                    const name = d.mechanism ?? d.mechanism_slug ?? `Driver ${i + 1}`;
                    const conf = d.confidence != null
                      ? ` — ${typeof d.confidence === "number" ? `${Math.round(d.confidence * 100)}%` : d.confidence}`
                      : "";
                    return (
                      <li key={i} className="text-sm text-gray-800">
                        <span className="font-medium" style={{ color: "#2B2D42" }}>{name}</span>
                        <span className="text-gray-500 text-xs">{conf}</span>
                        {d.reasoning && (
                          <span className="block pl-4 text-xs text-gray-500 mt-0.5 leading-relaxed">
                            {d.reasoning}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* ── Supplements discussed ── */}
            {supplements.length > 0 && (
              <div className="space-y-1.5">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Supplements discussed
                </div>
                <ul className="list-disc list-inside space-y-1">
                  {supplements.map((sup, i) => {
                    const name = sup.name ?? sup.supplement_slug ?? `Supplement ${i + 1}`;
                    const dose = sup.dose ? ` · ${sup.dose}` : "";
                    const timing = sup.timing ? ` · ${sup.timing}` : "";
                    return (
                      <li key={i} className="text-sm text-gray-800">
                        <span className="font-medium">{name}</span>
                        <span className="text-gray-500 text-xs">{dose}{timing}</span>
                        {sup.rationale && (
                          <span className="block pl-4 text-xs text-gray-500 mt-0.5 leading-relaxed">
                            {sup.rationale}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ── Labs ordered ── */}
            {labs.length > 0 && (
              <div className="space-y-1.5">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Labs ordered
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {labs.map((lab) => (
                    <span
                      key={lab}
                      className="text-xs font-medium px-2 py-0.5 rounded-full border"
                      style={{ borderColor: "#D97706", color: "#92400E", background: "#FFFBEB" }}
                    >
                      🧪 {lab}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Five Pillars snapshot ── */}
            {fp && Object.values(fp).some((v) => v != null) && (
              <div className="space-y-2">
                <div className="brief-section-header text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Five pillars snapshot
                </div>
                <div className="flex flex-wrap gap-3">
                  {PILLARS.map(({ key, label, max, invert }) => {
                    const val = fp[key];
                    if (val == null) return null;
                    const score = Number(val);
                    const color = pillarColor(score, max, invert);
                    return (
                      <div
                        key={key}
                        className="flex flex-col items-center rounded-lg border px-3 py-2 min-w-[68px] text-center"
                        style={{ borderColor: color + "55", background: color + "11" }}
                      >
                        <span className="text-[11px] text-gray-500 leading-tight">{label}</span>
                        <span className="text-base font-bold mt-0.5" style={{ color }}>
                          {score}
                          <span className="text-[10px] font-normal text-gray-400">/{max}</span>
                        </span>
                      </div>
                    );
                  })}
                  {fp.sleep_hours != null && (
                    <div
                      className="flex flex-col items-center rounded-lg border px-3 py-2 min-w-[68px] text-center"
                      style={{ borderColor: "#8D99AE55", background: "#8D99AE11" }}
                    >
                      <span className="text-[11px] text-gray-500 leading-tight">😴 hrs</span>
                      <span className="text-base font-bold mt-0.5 text-gray-700">
                        {fp.sleep_hours}
                        <span className="text-[10px] font-normal text-gray-400">h</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Footer ── */}
            <div className="brief-footer border-t pt-3 text-[10px] text-center" style={{ color: "#16a34a" }}>
              Generated by HealWithShivaniH · healwithshivanih.com · Confidential
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
