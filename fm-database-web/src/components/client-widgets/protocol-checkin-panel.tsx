"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadActivePlanItemsAction, type PlanSupplementItem, type PlanPracticeItem } from "@/lib/server-actions/clients";
import { saveSessionAction, appendCheckInToPlanAction } from "@/lib/server-actions/assess";
import { supplementDisplayName } from "@/lib/fmdb/supplement-display";

interface Props {
  clientId: string;
  planSlug?: string;
  onSaved?: (sessionId: string) => void;
}

// ── Per-item adherence types ───────────────────────────────────────────────────

type SuppStatus = "still_taking" | "sometimes" | "side_effects" | "stopped";
type PracticeRating = "consistent" | "mostly" | "struggling" | "not_doing";

const SUPP_STATUSES: { value: SuppStatus; label: string; color: string }[] = [
  { value: "still_taking", label: "Taking ✅",       color: "border-emerald-400 bg-emerald-50 text-emerald-800" },
  { value: "sometimes",    label: "Sometimes 🔄",    color: "border-blue-400 bg-blue-50 text-blue-800" },
  { value: "side_effects", label: "Side effects ⚠️", color: "border-amber-400 bg-amber-50 text-amber-800" },
  { value: "stopped",      label: "Stopped ❌",       color: "border-red-400 bg-red-50 text-red-800" },
];

const PRACTICE_RATINGS: { value: PracticeRating; label: string; color: string }[] = [
  { value: "consistent",  label: "Consistent ✅",   color: "border-emerald-400 bg-emerald-50 text-emerald-800" },
  { value: "mostly",      label: "Mostly 🟢",       color: "border-blue-400 bg-blue-50 text-blue-800" },
  { value: "struggling",  label: "Struggling 🟡",   color: "border-amber-400 bg-amber-50 text-amber-800" },
  { value: "not_doing",   label: "Not doing ❌",     color: "border-red-400 bg-red-50 text-red-800" },
];

// ── Supplement row ─────────────────────────────────────────────────────────────

function SupplementRow({
  item,
  status,
  note,
  onStatus,
  onNote,
}: {
  item: PlanSupplementItem;
  status?: SuppStatus;
  note?: string;
  onStatus: (s: SuppStatus) => void;
  onNote: (n: string) => void;
}) {
  const name = supplementDisplayName(item);
  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="text-xs font-semibold">
        {name}
        {item.dose && <span className="text-muted-foreground font-normal"> · {item.dose}</span>}
        {item.timing && <span className="text-muted-foreground font-normal"> · {item.timing}</span>}
        {item.form && <span className="text-muted-foreground font-normal"> · {item.form}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {SUPP_STATUSES.map((st) => (
          <button
            key={st.value}
            type="button"
            onClick={() => onStatus(st.value)}
            className={`text-[11px] px-2 py-0.5 rounded-full border font-medium transition-all ${
              status === st.value ? st.color : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
      {(status === "side_effects" || status === "stopped" || status === "sometimes") && (
        <input
          type="text"
          value={note ?? ""}
          onChange={(e) => onNote(e.target.value)}
          placeholder={
            status === "side_effects" ? "Describe the side effect…"
            : status === "stopped" ? "Why did they stop?"
            : "How often? Any barriers?"
          }
          className="w-full text-[11px] rounded border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
      )}
    </div>
  );
}

// ── Lifestyle practice row ─────────────────────────────────────────────────────

function PracticeRow({
  item,
  rating,
  onRating,
}: {
  item: PlanPracticeItem;
  rating?: PracticeRating;
  onRating: (r: PracticeRating) => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="text-xs font-semibold">
        {item.name}
        <span className="text-muted-foreground font-normal"> · {item.cadence}</span>
        {item.details && (
          <span className="text-muted-foreground font-normal"> · {item.details}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {PRACTICE_RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onRating(r.value)}
            className={`text-[11px] px-2 py-0.5 rounded-full border font-medium transition-all ${
              rating === r.value ? r.color : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function ProtocolCheckinPanel({ clientId, planSlug, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supplements, setSupplements] = useState<PlanSupplementItem[]>([]);
  const [practices, setPractices] = useState<PlanPracticeItem[]>([]);
  const [suppAdherence, setSuppAdherence] = useState<Record<number, SuppStatus>>({});
  const [suppNotes, setSuppNotes] = useState<Record<number, string>>({});
  const [practiceRatings, setPracticeRatings] = useState<Record<number, PracticeRating>>({});
  const [overallNote, setOverallNote] = useState("");
  const [isSaving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  if (!planSlug) return null;

  const handleOpen = async () => {
    setOpen(true);
    if (supplements.length > 0 || practices.length > 0) return; // already loaded
    setLoading(true);
    try {
      const res = await loadActivePlanItemsAction(planSlug);
      if (res.ok) {
        setSupplements(res.supplements ?? []);
        setPractices(res.practices ?? []);
      } else {
        toast.error(res.error ?? "Failed to load plan items");
      }
    } finally {
      setLoading(false);
    }
  };

  const onSave = () => {
    startSave(async () => {
      const lines: string[] = ["📋 Protocol check-in (per-item adherence)\n"];

      if (supplements.length > 0) {
        lines.push("## 💊 Supplements");
        supplements.forEach((s, i) => {
          const st = suppAdherence[i];
          const note = suppNotes[i];
          const emoji = st === "still_taking" ? "✅" : st === "sometimes" ? "🔄" : st === "side_effects" ? "⚠️" : st === "stopped" ? "❌" : "—";
          const name = supplementDisplayName(s);
          const detail = [s.dose, s.timing].filter(Boolean).join(", ");
          lines.push(`${emoji} ${name}${detail ? ` (${detail})` : ""}${note ? `: ${note}` : ""}`);
        });
      }

      if (practices.length > 0) {
        lines.push("\n## 🌿 Lifestyle practices");
        practices.forEach((p, i) => {
          const r = practiceRatings[i];
          const emoji = r === "consistent" ? "✅" : r === "mostly" ? "🟢" : r === "struggling" ? "🟡" : r === "not_doing" ? "❌" : "—";
          lines.push(`${emoji} ${p.name} (${p.cadence})`);
        });
      }

      if (overallNote.trim()) {
        lines.push(`\n**Coach notes:** ${overallNote.trim()}`);
      }

      const noteText = lines.join("\n");
      const todayStr = new Date().toISOString().slice(0, 10);

      const res = await saveSessionAction({
        client_id: clientId,
        session_type: "check_in",
        presenting_complaints: `[session_type: protocol_checkin]\n\n${noteText}`,
      });

      if (!res.ok) { toast.error(`Save failed: ${res.error}`); return; }

      // Also append to plan notes_for_coach
      await appendCheckInToPlanAction(planSlug, noteText, todayStr);

      setSaved(true);
      toast.success(`✓ Protocol check-in saved`);
      if (res.session_id && onSaved) onSaved(res.session_id);
    });
  };

  const reset = () => {
    setSuppAdherence({});
    setSuppNotes({});
    setPracticeRatings({});
    setOverallNote("");
    setSaved(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        💊 Protocol check-in
      </button>
    );
  }

  const hasItems = supplements.length > 0 || practices.length > 0;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm flex items-center gap-1.5">💊 Protocol check-in</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Rate adherence for each supplement and lifestyle practice in the active plan.
          </p>
        </div>
        <button
          onClick={reset}
          className="text-muted-foreground hover:text-foreground text-xs shrink-0"
        >
          ✕ close
        </button>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading plan items…</p>
      )}

      {!loading && !hasItems && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          No supplements or lifestyle practices found in the active plan. Fill them in the Plan tab first.
        </div>
      )}

      {!loading && hasItems && !saved && (
        <>
          {supplements.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                💊 Supplements ({supplements.length})
              </p>
              <div className="space-y-2">
                {supplements.map((s, i) => (
                  <SupplementRow
                    key={i}
                    item={s}
                    status={suppAdherence[i]}
                    note={suppNotes[i]}
                    onStatus={(st) => setSuppAdherence((prev) => ({ ...prev, [i]: st }))}
                    onNote={(n) => setSuppNotes((prev) => ({ ...prev, [i]: n }))}
                  />
                ))}
              </div>
            </div>
          )}

          {practices.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                🌿 Lifestyle practices ({practices.length})
              </p>
              <div className="space-y-2">
                {practices.map((p, i) => (
                  <PracticeRow
                    key={i}
                    item={p}
                    rating={practiceRatings[i]}
                    onRating={(r) => setPracticeRatings((prev) => ({ ...prev, [i]: r }))}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
              Coach notes (optional)
            </p>
            <textarea
              value={overallNote}
              onChange={(e) => setOverallNote(e.target.value)}
              rows={2}
              placeholder="Patterns noticed, protocol adjustments to consider, client concerns…"
              className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>

          <Button type="button" onClick={onSave} disabled={isSaving} className="text-sm">
            {isSaving ? "Saving…" : "💾 Save protocol check-in"}
          </Button>
        </>
      )}

      {saved && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          ✓ Check-in saved to session history and appended to plan notes.
          <button onClick={reset} className="ml-2 underline">Close</button>
        </div>
      )}
    </div>
  );
}
