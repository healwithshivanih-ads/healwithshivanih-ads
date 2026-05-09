"use client";

import { useState, useEffect, useRef } from "react";
import { loadActivePlanItemsAction, type PlanSupplementItem, type PlanPracticeItem } from "@/app/clients/actions";
import { saveSessionAction } from "@/app/assess/actions";
import type { SessionSummary } from "@/app/assess/actions";
import type { Client } from "@/lib/fmdb/types";

interface Props {
  client: Client;
  clientId: string;
  sessions: SessionSummary[];
  activePlanSlug?: string;
  activePlanStart?: string;
  activePlanRecheck?: string;
  pendingLabs?: string[];
}

// ── Print-optimised CSS injected inline ───────────────────────────────────────

const PRINT_STYLES = `
@media print {
  body > *:not(#session-brief-print) { display: none !important; }
  #session-brief-print { display: block !important; }
  .no-print { display: none !important; }
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground border-b pb-0.5">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Brief content (rendered both in panel + print) ────────────────────────────

function BriefContent({
  client,
  sessions,
  activePlanSlug,
  activePlanStart,
  activePlanRecheck,
  pendingLabs,
  supplements,
  practices,
  loading,
}: Props & {
  supplements: PlanSupplementItem[];
  practices: PlanPracticeItem[];
  loading: boolean;
}) {
  const c = client as Record<string, unknown>;
  const name = (c.display_name as string | undefined) ?? (c.client_id as string);
  const conditions = (c.active_conditions as string[] | undefined) ?? [];
  const meds = (c.current_medications as string[] | undefined) ?? (c.medications as string[] | undefined) ?? [];
  const allergies = (c.allergies as string[] | undefined) ?? (c.known_allergies as string[] | undefined) ?? [];
  const goals = (c.goals as string[] | undefined) ?? [];
  const ageBand = (c.age_band as string | undefined);

  // Most recent intake or check-in session
  const lastSession = sessions.find(
    (s) => s.session_type === "intake" || s.session_type === "check_in"
  );

  // All quick notes since last intake session
  const lastFullIdx = sessions.findIndex((s) => s.session_type === "intake");
  const recentNotes = lastFullIdx > 0
    ? sessions.slice(0, lastFullIdx).filter((s) => s.session_type === "quick_note")
    : sessions.filter((s) => s.session_type === "quick_note").slice(0, 5);


  // Key symptoms from last session
  const lastSymptoms = (lastSession?.selected_symptoms ?? []).slice(0, 8);

  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {/* Client header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{name}</h2>
          <p className="text-xs text-muted-foreground">
            {[ageBand, (c.sex as string), (c.city as string)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>Brief generated {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
          {activePlanSlug && <p className="font-medium text-foreground">Plan: {activePlanSlug}</p>}
        </div>
      </div>

      {/* Conditions + meds */}
      <Section title="Clinical snapshot">
        {conditions.length > 0 && (
          <p className="text-xs"><strong>Conditions:</strong> {conditions.join(", ")}</p>
        )}
        {meds.length > 0 && (
          <p className="text-xs"><strong>Medications:</strong> {meds.join(", ")}</p>
        )}
        {allergies.length > 0 && (
          <p className="text-xs"><strong>Allergies / intolerances:</strong> {allergies.join(", ")}</p>
        )}
        {goals.length > 0 && (
          <p className="text-xs"><strong>Goals:</strong> {goals.join(", ")}</p>
        )}
        {conditions.length === 0 && meds.length === 0 && allergies.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No clinical data on file.</p>
        )}
      </Section>

      {/* Last session */}
      {lastSession && (
        <Section title={`Last session — ${fmt(lastSession.date)}`}>
          {lastSymptoms.length > 0 && (
            <p className="text-xs"><strong>Symptoms flagged:</strong> {lastSymptoms.join(", ")}</p>
          )}
          {lastSession.driver_count > 0 && (
            <p className="text-xs"><strong>Root cause drivers identified:</strong> {lastSession.driver_count}</p>
          )}
          {lastSession.supplement_count > 0 && (
            <p className="text-xs"><strong>Supplements in protocol:</strong> {lastSession.supplement_count}</p>
          )}
          {lastSession.synthesis_notes && (
            <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">
              {lastSession.synthesis_notes.slice(0, 400)}
            </p>
          )}
          {!lastSession.synthesis_notes && lastSession.presenting_complaints && (
            <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-3">
              {lastSession.presenting_complaints
                .replace(/^\[session_type:[^\]]+\]\s*/i, "")
                .slice(0, 300)}
            </p>
          )}
        </Section>
      )}

      {/* Pending labs */}
      {(pendingLabs ?? []).length > 0 && (
        <Section title="🧪 Pending labs">
          <ul className="text-xs list-disc list-inside space-y-0.5">
            {(pendingLabs ?? []).map((lab, i) => (
              <li key={i}>{lab}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Active plan — supplements */}
      {activePlanSlug && (
        <Section title={`Active plan${activePlanStart ? ` · Started ${fmt(activePlanStart)}` : ""}${activePlanRecheck ? ` · Recheck ${fmt(activePlanRecheck)}` : ""}`}>
          {loading && <p className="text-xs text-muted-foreground italic">Loading plan…</p>}
          {!loading && supplements.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">💊 Supplements</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {supplements.map((s, i) => (
                  <p key={i} className="text-xs">
                    <strong>{s.supplement_slug.replace(/-/g, " ")}</strong>
                    {s.dose && ` · ${s.dose}`}
                    {s.timing && ` · ${s.timing}`}
                  </p>
                ))}
              </div>
            </div>
          )}
          {!loading && practices.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">🌿 Lifestyle practices</p>
              <ul className="text-xs list-disc list-inside space-y-0.5">
                {practices.map((p, i) => (
                  <li key={i}>{p.name} · {p.cadence}</li>
                ))}
              </ul>
            </div>
          )}
          {!loading && supplements.length === 0 && practices.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No items in plan yet.</p>
          )}
        </Section>
      )}

      {/* Recent client messages */}
      {recentNotes.length > 0 && (
        <Section title={`Recent notes (${recentNotes.length} since last session)`}>
          <div className="space-y-2">
            {recentNotes.map((n, i) => {
              const raw = (n.presenting_complaints ?? "")
                .replace(/^\[session_type:[^\]]+\]\s*/i, "")
                .replace(/^\[source:[^\]]+\]\s*/i, "")
                .trim()
                .slice(0, 300);
              return (
                <div key={i} className="rounded border px-2 py-1.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground mb-0.5">{fmt(n.date)}</p>
                  <p className="text-xs whitespace-pre-line">{raw}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Questions to ask */}
      <Section title="Questions to explore">
        <ul className="text-xs list-disc list-inside space-y-0.5 text-muted-foreground">
          {lastSymptoms.length > 0 && <li>How are the {lastSymptoms.slice(0, 2).join(", ")} compared to last session?</li>}
          {supplements.length > 0 && <li>How is adherence to the supplement protocol?</li>}
          {practices.length > 0 && <li>How have the lifestyle practices been going?</li>}
          {(pendingLabs ?? []).length > 0 && <li>Have the pending lab results come back?</li>}
          <li>Sleep, stress, and energy since we last spoke?</li>
          <li>Any new foods, reactions, or triggers to note?</li>
        </ul>
      </Section>
    </div>
  );
}

// ── Quick note widget (inside brief modal) ────────────────────────────────────

type NoteSource = "coach_observation" | "pre_session_thought";

function QuickNoteWidget({ clientId }: { clientId: string }) {
  const [noteText, setNoteText] = useState("");
  const [source, setSource] = useState<NoteSource>("coach_observation");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleSave = async () => {
    if (!noteText.trim()) return;
    setNoteSaving(true); setNoteError(null); setNoteSaved(false);
    const today = new Date().toISOString().slice(0, 10);
    const result = await saveSessionAction({
      client_id: clientId,
      session_type: "quick_note",
      presenting_complaints: `[source: pre_session_brief]\n\n${noteText.trim()}`,
      session_date: today,
    });
    setNoteSaving(false);
    if (!result.ok) {
      setNoteError(result.error ?? "Failed to save note");
      return;
    }
    setNoteText("");
    setNoteSaved(true);
    savedTimerRef.current = setTimeout(() => setNoteSaved(false), 3000);
  };

  const sourceOptions: { value: NoteSource; label: string }[] = [
    { value: "coach_observation",  label: "Coach observation" },
    { value: "pre_session_thought", label: "Pre-session thought" },
  ];

  return (
    <div className="border-t pt-4 space-y-2">
      <h3 className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground border-b pb-0.5">
        📝 Quick note
      </h3>
      {/* Source selector */}
      <div className="flex items-center gap-3">
        {sourceOptions.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input
              type="radio"
              name="quick-note-source"
              value={value}
              checked={source === value}
              onChange={() => setSource(value)}
              className="accent-indigo-600"
            />
            {label}
          </label>
        ))}
      </div>
      <textarea
        rows={3}
        value={noteText}
        onChange={(e) => { setNoteText(e.target.value); setNoteSaved(false); setNoteError(null); }}
        placeholder="Jot a note — saved as quick note on this client..."
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={noteSaving || !noteText.trim()}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 transition-opacity"
          style={{ background: "var(--brand-indigo, #2B2D42)" }}
        >
          {noteSaving ? "Saving…" : "Save note"}
        </button>
        {noteSaved && (
          <span className="text-xs text-emerald-700 font-medium animate-in fade-in">✓ Saved</span>
        )}
        {noteError && (
          <span className="text-xs text-red-600">{noteError}</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PreSessionBrief({
  client,
  clientId,
  sessions,
  activePlanSlug,
  activePlanStart,
  activePlanRecheck,
  pendingLabs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supplements, setSupplements] = useState<PlanSupplementItem[]>([]);
  const [practices, setPractices] = useState<PlanPracticeItem[]>([]);

  const handleOpen = async () => {
    setOpen(true);
    if (activePlanSlug && supplements.length === 0) {
      setLoading(true);
      try {
        const res = await loadActivePlanItemsAction(activePlanSlug);
        if (res.ok) {
          setSupplements(res.supplements ?? []);
          setPractices(res.practices ?? []);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        📋 Session brief
      </button>
    );
  }

  return (
    <>
      {/* Print CSS */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Modal overlay */}
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto no-print">
        <div
          id="session-brief-print"
          className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 space-y-4 my-4"
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 no-print">
            <h2 className="font-semibold text-base">📋 Pre-session coach brief</h2>
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="text-xs px-3 py-1.5 rounded-md border font-medium hover:bg-muted transition-colors"
              >
                🖨 Print / Save PDF
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-xs px-3 py-1.5 rounded-md border font-medium hover:bg-muted transition-colors"
              >
                ✕ Close
              </button>
            </div>
          </div>

          {/* Brief content */}
          <BriefContent
            client={client}
            clientId={clientId}
            sessions={sessions}
            activePlanSlug={activePlanSlug}
            activePlanStart={activePlanStart}
            activePlanRecheck={activePlanRecheck}
            pendingLabs={pendingLabs}
            supplements={supplements}
            practices={practices}
            loading={loading}
          />

          {/* Quick note — jot observations without closing the brief */}
          <QuickNoteWidget clientId={clientId} />
        </div>
      </div>
    </>
  );
}
