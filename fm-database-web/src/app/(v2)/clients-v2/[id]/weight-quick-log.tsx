"use client";

/**
 * WeightQuickLog — inline "log a new weight" control for the client Overview.
 *
 * Overview showed weight read-only; changing it meant opening a check-in or
 * editing a session. This writes a dated reading straight through
 * addMeasurementAction (same path as the check-in), which appends to
 * measurements_log AND reconciles the flat current-weight fields — so the new
 * reading becomes the current weight everywhere (menu protein floor, letters,
 * dashboards) while older readings stay in the trend for comparison.
 *
 * Newest date wins on the read side, so a backdated correction is kept as
 * history and never overrides a more recent weigh-in.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addMeasurementAction } from "@/lib/server-actions/clients";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function humanDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function WeightQuickLog({
  clientId,
  currentWeightKg,
  currentWeightDate,
}: {
  clientId: string;
  currentWeightKg: number | null;
  currentWeightDate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kg, setKg] = useState("");
  const [date, setDate] = useState(todayISO());
  const [pending, start] = useTransition();

  function submit() {
    const w = Number.parseFloat(kg);
    if (!Number.isFinite(w) || w < 20 || w > 400) {
      toast.error("Enter a weight in kg between 20 and 400.");
      return;
    }
    if (!date) {
      toast.error("Pick a date for this reading.");
      return;
    }
    start(async () => {
      const res = await addMeasurementAction({ client_id: clientId, date, weight_kg: w });
      if (res.ok) {
        const isBackdated = currentWeightDate && date < currentWeightDate;
        toast.success(
          isBackdated
            ? `✓ Added ${w} kg for ${humanDate(date)} (kept as history — ${currentWeightKg} kg on ${humanDate(currentWeightDate)} is still current)`
            : `✓ Logged ${w} kg — now the current weight`,
        );
        setOpen(false);
        setKg("");
        setDate(todayISO());
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not log weight.");
      }
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden>⚖️</span>
        <span style={{ color: "var(--fm-text-secondary)" }}>Weight</span>
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>
          {currentWeightKg != null ? `${currentWeightKg} kg` : "—"}
        </strong>
        {currentWeightDate && (
          <span style={{ color: "var(--fm-text-tertiary)", fontSize: 11 }}>
            · {humanDate(currentWeightDate)}
          </span>
        )}
      </span>

      {!open ? (
        <button
          type="button"
          className="FmBtn FmBtn--ghost FmBtn--sm"
          onClick={() => setOpen(true)}
        >
          ＋ Log new
        </button>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input
            type="number"
            step="0.1"
            min={20}
            max={400}
            inputMode="decimal"
            autoFocus
            placeholder="kg"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            disabled={pending}
            style={{
              width: 78,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--fm-border, #d8d5cf)",
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
            title="Date of this reading — defaults to today; pick an earlier date to log a past weigh-in"
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--fm-border, #d8d5cf)",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            className="FmBtn FmBtn--primary FmBtn--sm"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="FmBtn FmBtn--ghost FmBtn--sm"
            onClick={() => {
              setOpen(false);
              setKg("");
            }}
            disabled={pending}
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}
