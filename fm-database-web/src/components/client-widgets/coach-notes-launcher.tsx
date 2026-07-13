"use client";

/**
 * CoachNotesButton — a persistent "📝 Coach notes" button for the shared
 * client chrome (the identity strip on every tab + the Overview header).
 *
 * Clicking it opens a modal with the ACTIVE plan's `notes_for_coach` — the
 * coach's private clinical reasoning — rendered with the same FmCoachNotes
 * markdown component the Plan tab used. Moving it here (2026-06-14) means the
 * reasoning is one click away from any tab (Record, Communicate, History…),
 * not buried at the top of the Plan tab where it dominated the page.
 *
 * Notes load lazily on first open (getClientCoachNotesAction), so the button
 * is cheap to mount everywhere.
 */

import { useCallback, useEffect, useState } from "react";
import { getClientCoachNotesAction } from "@/lib/server-actions/plans";
import { FmCoachNotes } from "@/components/fm/FmCoachNotes";

export function CoachNotesButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ notesForCoach: string; planSlug: string } | null>(null);
  const [error, setError] = useState("");

  const openModal = useCallback(async () => {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError("");
    try {
      const r = await getClientCoachNotesAction(clientId);
      if (r.ok) setData({ notesForCoach: r.notesForCoach, planSlug: r.planSlug });
      else setError(r.error);
    } catch {
      setError("Couldn't load the notes — please try again.");
    }
    setLoading(false);
  }, [clientId, data, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={openModal}
        title="Your private clinical reasoning for the active plan"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--fm-secondary)",
          background: "color-mix(in srgb, var(--fm-secondary) 7%, var(--fm-surface))",
          border: "1px solid color-mix(in srgb, var(--fm-secondary) 30%, transparent)",
          borderRadius: "var(--fm-radius-sm)",
          padding: "5px 10px",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        📝 Coach notes
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
            role="dialog"
            aria-label="Notes for coach"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 border-b bg-white rounded-t-xl">
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
                📝 Notes for coach
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  fontSize: 18,
                  lineHeight: 1,
                  color: "var(--fm-text-tertiary)",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "14px 20px 22px" }}>
              {loading && (
                <p style={{ fontSize: 13, color: "var(--fm-text-tertiary)" }}>Loading notes…</p>
              )}
              {!loading && error && (
                <p style={{ fontSize: 13, color: "var(--fm-danger)" }}>{error}</p>
              )}
              {!loading && !error && data && data.notesForCoach.trim() && (
                <>
                  <p style={{ fontSize: 12, color: "var(--fm-text-secondary)", margin: "0 0 12px" }}>
                    Your clinical reasoning for the active plan · private — never appears in the client app.
                  </p>
                  <FmCoachNotes text={data.notesForCoach} planSlug={data.planSlug} />
                </>
              )}
              {!loading && !error && data && !data.notesForCoach.trim() && (
                <p style={{ fontSize: 13, color: "var(--fm-text-tertiary)" }}>
                  No coach notes on the active plan yet — they&apos;re written when you generate or
                  edit a plan.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
