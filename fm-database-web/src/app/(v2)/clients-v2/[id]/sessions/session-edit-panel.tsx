"use client";

/**
 * SessionEditPanel — inline edit for a single session displayed in the
 * timeline / sessions browser.
 *
 * Two exports:
 *   - SessionEditPanel (this file's default-style wrapper) renders both
 *     the trigger button AND the expansion panel together. Use when the
 *     parent has flex-wrap layout and is happy to let the panel break
 *     to a new line.
 *   - SessionEditControls (button) + SessionEditForm (panel body) when
 *     you need the trigger and the form rendered in different parts of
 *     the page tree (e.g. trigger in actions row, form below). Hooked
 *     up via a small context hook.
 *
 * Scope (deliberately narrow):
 *   - Coach notes (the main freeform body)
 *   - Measurements (weight / waist / BP / HR)
 *   - Presenting complaints (the tag-stripped narrative)
 *
 * Frozen (never editable post-hoc): session_id, client_id, date,
 * session_type, created_at. Those are audit anchors — fixing them
 * silently would break dedup, journey computation, and the "logged
 * at" timestamp.
 *
 * Append a fresh check-in via the /analyse/checkin form instead of
 * editing an existing one when the change is large enough to be
 * conceptually a new event. This affordance is for "I forgot to add
 * X" / "actually the weight was 78.2 not 78.7" — quick fixes.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateSessionFieldsAction } from "@/lib/server-actions/assess";
import { addMeasurementAction } from "@/lib/server-actions/clients";
import { FmField, FmInput, FmTextarea } from "@/components/fm";

interface InitialMeasurements {
  weight_kg?: number | null;
  waist_cm?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  hr_bpm?: number | null;
}

export interface SessionEditPanelProps {
  clientId: string;
  sessionId: string;
  sessionType: string;
  /** YYYY-MM-DD of the session — used as the date for the
   *  measurements_log entry created when measurements are saved.
   *  Without it the log entry would land on `today` which corrupts
   *  the time series for past-dated session edits. */
  sessionDate?: string;
  initialCoachNotes: string;
  initialPresenting?: string;
  initialMeasurements?: InitialMeasurements | null;
}

function toStr(n: number | null | undefined): string {
  return n != null ? String(n) : "";
}

/** Self-contained edit panel — button + form, vertically stacked. */
export function SessionEditPanel(props: SessionEditPanelProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Edit this ${props.sessionType.replace("_", " ")} session`}
        style={{
          padding: "7px 14px",
          fontSize: 12,
          fontWeight: 700,
          background: "var(--fm-surface)",
          color: "var(--fm-text-primary)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ✏️ Edit
      </button>
    );
  }

  return (
    <div style={{ flexBasis: "100%" }}>
      <SessionEditForm {...props} onClose={() => setOpen(false)} />
    </div>
  );
}

interface SessionEditFormProps extends SessionEditPanelProps {
  onClose: () => void;
}

function SessionEditForm({
  clientId,
  sessionId,
  sessionDate,
  initialCoachNotes,
  initialPresenting,
  initialMeasurements,
  onClose,
}: SessionEditFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [coachNotes, setCoachNotes] = useState(initialCoachNotes);
  const [presenting, setPresenting] = useState(initialPresenting ?? "");
  const [weight, setWeight] = useState(toStr(initialMeasurements?.weight_kg));
  const [waist, setWaist] = useState(toStr(initialMeasurements?.waist_cm));
  const [bpSys, setBpSys] = useState(toStr(initialMeasurements?.bp_systolic));
  const [bpDia, setBpDia] = useState(toStr(initialMeasurements?.bp_diastolic));
  const [hr, setHr] = useState(toStr(initialMeasurements?.hr_bpm));

  const dirty =
    coachNotes !== initialCoachNotes ||
    presenting !== (initialPresenting ?? "") ||
    weight !== toStr(initialMeasurements?.weight_kg) ||
    waist !== toStr(initialMeasurements?.waist_cm) ||
    bpSys !== toStr(initialMeasurements?.bp_systolic) ||
    bpDia !== toStr(initialMeasurements?.bp_diastolic) ||
    hr !== toStr(initialMeasurements?.hr_bpm);

  const onSave = () => {
    if (!dirty) {
      onClose();
      return;
    }
    start(async () => {
      const parseMaybe = (
        s: string,
        prevVal: number | null | undefined,
      ): number | null | undefined => {
        if (s.trim() === "") {
          return prevVal != null ? null : undefined;
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const measurements = {
        weight_kg: parseMaybe(weight, initialMeasurements?.weight_kg),
        waist_cm: parseMaybe(waist, initialMeasurements?.waist_cm),
        bp_systolic: parseMaybe(bpSys, initialMeasurements?.bp_systolic),
        bp_diastolic: parseMaybe(bpDia, initialMeasurements?.bp_diastolic),
        hr_bpm: parseMaybe(hr, initialMeasurements?.hr_bpm),
      };
      let result;
      try {
        result = await updateSessionFieldsAction({
          client_id: clientId,
          session_id: sessionId,
          coach_notes: coachNotes !== initialCoachNotes ? coachNotes : undefined,
          presenting_complaints:
            presenting !== (initialPresenting ?? "") ? presenting : undefined,
          measurements,
        });
      } catch (e) {
        // Audit Phase-1b: a thrown action (rotated Server Action ID, etc.)
        // previously left the panel open with NO toast. Surface it.
        toast.error("Save failed: " + (e as Error).message);
        return;
      }

      // Also flow numeric measurement values into measurements_log so the
      // body comp trend + outcomes panel + dashboard see them. Edit panel
      // changes were previously isolated to the session YAML, so updating
      // a check-in's weight here wouldn't update the trend. Best-effort:
      // failure here doesn't block the session save success toast.
      const measurementChanged =
        weight !== toStr(initialMeasurements?.weight_kg) ||
        waist !== toStr(initialMeasurements?.waist_cm) ||
        bpSys !== toStr(initialMeasurements?.bp_systolic) ||
        bpDia !== toStr(initialMeasurements?.bp_diastolic) ||
        hr !== toStr(initialMeasurements?.hr_bpm);
      const dateForLog =
        sessionDate ?? new Date().toISOString().slice(0, 10);
      if (result.ok && measurementChanged) {
        // Only push numeric values — clearing a field doesn't reach
        // measurements_log (addMeasurementAction ignores undefined keys
        // anyway, so cleared values stay as-is in the log).
        const w = weight ? parseFloat(weight) : undefined;
        const wc = waist ? parseFloat(waist) : undefined;
        const bps = bpSys ? parseFloat(bpSys) : undefined;
        const bpd = bpDia ? parseFloat(bpDia) : undefined;
        const hrate = hr ? parseFloat(hr) : undefined;
        try {
          const mr = await addMeasurementAction({
            client_id: clientId,
            date: dateForLog,
            weight_kg: Number.isFinite(w) ? w : undefined,
            waist_cm: Number.isFinite(wc) ? wc : undefined,
            blood_pressure_systolic: Number.isFinite(bps) ? bps : undefined,
            blood_pressure_diastolic: Number.isFinite(bpd) ? bpd : undefined,
            resting_heart_rate: Number.isFinite(hrate) ? hrate : undefined,
            notes: `from session ${sessionId} edit`,
          });
          // Audit Phase-1b: don't silently ignore a failed measurement push —
          // the session saved but the trend/outcomes would diverge. Warn.
          if (mr && (mr as { ok?: boolean }).ok === false) {
            toast.warning("Session saved, but the measurement trend couldn't be updated.");
          }
        } catch {
          toast.warning("Session saved, but the measurement trend couldn't be updated.");
        }
      }

      if (result.ok) {
        toast.success("Session updated");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        background: "var(--fm-bg-warm)",
        border: "1px solid rgba(245, 158, 11, 0.45)",
        borderRadius: "var(--fm-radius-sm)",
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          color: "#8a5a08",
        }}
      >
        ✏️ Editing session — changes save in place
      </div>

      <FmField
        label="Coach notes"
        hint="Full freeform body of this session. The audit field last_edited_at gets stamped on save."
      >
        {({ id }) => (
          <FmTextarea
            id={id}
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            rows={10}
          />
        )}
      </FmField>

      {(initialPresenting || presenting) && (
        <FmField
          label="Presenting complaints"
          hint="The narrative — keep any [session_type: ...] tags at the start."
        >
          {({ id }) => (
            <FmTextarea
              id={id}
              value={presenting}
              onChange={(e) => setPresenting(e.target.value)}
              rows={3}
            />
          )}
        </FmField>
      )}

      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            fontWeight: 700,
            color: "var(--fm-text-tertiary)",
            marginBottom: 6,
          }}
        >
          Measurements
          {initialMeasurements && (
            <span
              style={{
                fontWeight: 500,
                textTransform: "none",
                letterSpacing: 0,
                marginLeft: 8,
                fontSize: 10,
                opacity: 0.75,
              }}
            >
              · clear a field to remove it
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <FmField label="Weight" hint="kg">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="68.4"
              />
            )}
          </FmField>
          <FmField label="Waist" hint="cm">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                step="0.1"
                value={waist}
                onChange={(e) => setWaist(e.target.value)}
                placeholder="82"
              />
            )}
          </FmField>
          <FmField label="BP systolic" hint="mmHg">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                value={bpSys}
                onChange={(e) => setBpSys(e.target.value)}
                placeholder="118"
              />
            )}
          </FmField>
          <FmField label="BP diastolic" hint="mmHg">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                value={bpDia}
                onChange={(e) => setBpDia(e.target.value)}
                placeholder="76"
              />
            )}
          </FmField>
          <FmField label="Resting HR" hint="bpm">
            {({ id }) => (
              <FmInput
                id={id}
                type="number"
                value={hr}
                onChange={(e) => setHr(e.target.value)}
                placeholder="68"
              />
            )}
          </FmField>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 600,
            background: "var(--fm-surface)",
            color: "var(--fm-text-secondary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          style={{
            padding: "7px 16px",
            fontSize: 12,
            fontWeight: 700,
            background: dirty ? "var(--fm-primary)" : "var(--fm-bg-cool)",
            color: dirty ? "#fff" : "var(--fm-text-tertiary)",
            border: "1px solid transparent",
            borderRadius: "var(--fm-radius-sm)",
            cursor: dirty ? "pointer" : "not-allowed",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "💾 Save changes"}
        </button>
      </div>
    </div>
  );
}
