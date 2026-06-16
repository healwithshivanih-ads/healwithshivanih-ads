/**
 * TravelOverridesPanel — standalone widget for adding/removing travel,
 * festival, illness, and plateau-break overrides for ANY client.
 *
 * Decoupled from weight-loss state (coach feedback 2026-05-19): travel
 * info is needed before EVERY letter generation regardless of whether
 * the client has a weight-loss goal. Storage lives on
 * `client.weight_loss.week_overrides` for back-compat — that field
 * predates this widget split. The data is just protocol-level
 * scheduling metadata; weight-loss config is a separate concern.
 *
 * Lives on the Communicate tab so the coach sees + edits travel windows
 * right where she's about to generate the next letter.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addWeightLossOverride,
  removeWeightLossOverride,
  generateTravelGuideAction,
  type WeightLossWeekOverridePayload,
} from "@/lib/server-actions/clients";
import type { WeightLossWeekOverride } from "@/lib/fmdb/types";

export interface TravelOverridesPanelProps {
  clientId: string;
  /** Existing overrides from client.weight_loss.week_overrides. */
  overrides?: WeightLossWeekOverride[];
  /** True when at least one saved letter exists on disk for this client's
   *  active plan. Drives the post-save prompt — coach should be asked
   *  whether to mint a dedicated vacation letter, rather than silently
   *  invalidating the already-issued ones. */
  hasIssuedLetters?: boolean;
}

export function TravelOverridesPanel({
  clientId,
  overrides = [],
  hasIssuedLetters = false,
}: TravelOverridesPanelProps) {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onRemove = (index: number) => {
    if (pending) return;
    startTransition(async () => {
      const res = await removeWeightLossOverride(clientId, index);
      if (res.ok) {
        toast.success("Override removed");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't remove override");
      }
    });
  };

  // A — pre-author the in-app local-food guide against the client's active
  // travel flag (caches onto the flag so the app renders it first).
  const onGenerateGuide = () => {
    if (pending) return;
    startTransition(async () => {
      const res = await generateTravelGuideAction(clientId);
      if (res.ok) {
        toast.success("In-app food guide generated for this trip");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't generate guide");
      }
    });
  };

  return (
    <section
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        background: "var(--fm-bg-warm, #FAF8F4)",
        border: "1px solid var(--fm-border-light, #E5E2DD)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "var(--fm-text-3, #999)",
            }}
          >
            Travel / festival / illness overrides
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--fm-text-2, #5A5A5A)",
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            Set the trip window + destination. Then “Generate in-app guide”
            pre-builds the client’s local-food card (shows in their app).
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onGenerateGuide}
            disabled={pending}
            title="Pre-build the client's destination food guide in their app (needs an active travel flag + API credits)"
            style={{
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              background: "#fff",
              color: "var(--fm-primary, #FF6B35)",
              border: "1px solid var(--fm-primary, #FF6B35)",
              borderRadius: 6,
              cursor: pending ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {pending ? "Working…" : "✨ Generate in-app guide"}
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            disabled={pending}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--fm-primary, #FF6B35)",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              cursor: pending ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + Add override
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {overrides.length === 0 && (
          <span
            style={{
              fontSize: 12,
              color: "var(--fm-text-3, #999)",
              fontStyle: "italic",
            }}
          >
            None active — letters use the base protocol for every week.
          </span>
        )}
        {overrides.map((o, i) => (
          <OverrideChip
            key={i}
            override={o}
            disabled={pending}
            onRemove={() => onRemove(i)}
          />
        ))}
      </div>

      {showModal && (
        <AddOverrideModal
          clientId={clientId}
          hasIssuedLetters={hasIssuedLetters}
          onClose={() => setShowModal(false)}
        />
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────
// Chip — one row per override, click × to remove.
// ───────────────────────────────────────────────────────────────────
function OverrideChip({
  override,
  onRemove,
  disabled,
}: {
  override: WeightLossWeekOverride;
  onRemove: () => void;
  disabled: boolean;
}) {
  const dateLabel =
    override.date_from && override.date_to
      ? override.date_from === override.date_to
        ? fmtDate(override.date_from)
        : `${fmtDate(override.date_from)} → ${fmtDate(override.date_to)}`
      : override.weeks && override.weeks.length > 0
        ? override.weeks.length === 1
          ? `Wk ${override.weeks[0]}`
          : `Wks ${Math.min(...override.weeks)}–${Math.max(...override.weeks)}`
        : "—";

  const contextChip =
    override.context === "travel"
      ? `✈ ${override.location ?? "Travel"}`
      : override.context === "festival"
        ? "🎉 Festival"
        : override.context === "illness"
          ? "🤒 Illness"
          : override.context === "plateau_break"
            ? "⏸ Plateau break"
            : override.context === "other"
              ? "Other"
              : null;

  const modeLabel =
    override.mode === "maintenance"
      ? "Maintenance"
      : override.mode === "deeper_deficit"
        ? `Deeper deficit${override.kcal_offset !== undefined ? ` ${override.kcal_offset} kcal` : ""}`
        : "Skip";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "var(--fm-surface, #fff)",
        border: "1px solid var(--fm-border, #E5E2DD)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--fm-text, #1A1A1A)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{dateLabel}</span>
      {contextChip && (
        <span style={{ color: "var(--fm-text-2, #5A5A5A)", fontWeight: 600 }}>
          {contextChip}
        </span>
      )}
      <span
        style={{
          padding: "1px 7px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background:
            override.mode === "maintenance"
              ? "rgba(110, 76, 200, 0.10)"
              : override.mode === "skip"
                ? "rgba(120, 113, 108, 0.12)"
                : "rgba(245, 158, 11, 0.10)",
          color:
            override.mode === "maintenance"
              ? "#5a3fb0"
              : override.mode === "skip"
                ? "#5a5a5a"
                : "#92400e",
        }}
      >
        {modeLabel}
      </span>
      {override.reason && (
        <span style={{ color: "var(--fm-text-3, #999)" }}>
          — {override.reason}
        </span>
      )}
      <button
        type="button"
        aria-label="Remove override"
        onClick={onRemove}
        disabled={disabled}
        style={{
          marginLeft: 4,
          background: "transparent",
          border: 0,
          fontSize: 14,
          color: "var(--fm-text-3, #999)",
          cursor: disabled ? "not-allowed" : "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Modal — date range, context, location, mode, optional kcal/note.
// Same logic as the WeightLossCard's AddOverrideModal but standalone.
// ───────────────────────────────────────────────────────────────────
function AddOverrideModal({
  clientId,
  hasIssuedLetters = false,
  onClose,
}: {
  clientId: string;
  hasIssuedLetters?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date();
  const wkOut = new Date(today.getTime() + 7 * 86_400_000);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(isoDate(today));
  const [dateTo, setDateTo] = useState(isoDate(wkOut));
  const [context, setContext] = useState<
    "travel" | "festival" | "illness" | "plateau_break" | "other"
  >("travel");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<"maintenance" | "deeper_deficit" | "skip">(
    "maintenance",
  );
  const [kcalOffset, setKcalOffset] = useState("-200");
  const [reason, setReason] = useState("");

  const onSave = () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      toast.error("Pick a valid date range");
      return;
    }
    if (context === "travel" && !location.trim()) {
      toast.error("Add a destination — the letter uses it for local meal swaps");
      return;
    }
    const payload: WeightLossWeekOverridePayload = {
      date_from: dateFrom,
      date_to: dateTo,
      mode,
      context,
      location: location.trim() || undefined,
      reason: reason.trim() || undefined,
    };
    if (mode === "deeper_deficit") {
      const k = parseInt(kcalOffset, 10);
      if (Number.isFinite(k)) payload.kcal_offset = k;
    }
    startTransition(async () => {
      const res = await addWeightLossOverride(clientId, payload);
      if (res.ok) {
        onClose();
        router.refresh();
        // Two-path post-save UX (coach call 2026-05-19):
        //   1. Letters NOT yet issued → silent success; the next letter
        //      generation will pick up the override at render time
        //      (existing render-client-letter.py behaviour).
        //   2. Letters already issued → don't silently mass-regenerate.
        //      Surface a CTA toast asking coach whether to mint a
        //      dedicated vacation letter for this window. Coach clicks
        //      through to /communicate where the existing letter
        //      generator already reads week_overrides + recent notes.
        if (hasIssuedLetters && context === "travel" && location.trim()) {
          toast(
            `🧳 Travel saved · ${location.trim()} (${dateFrom} → ${dateTo})`,
            {
              description:
                "Letters are already issued. Want a dedicated vacation letter for this window?",
              duration: 12000,
              action: {
                label: "Generate vacation letter →",
                onClick: () => {
                  router.push(
                    `/clients-v2/${clientId}/communicate?intent=vacation_letter&from=${encodeURIComponent(
                      dateFrom,
                    )}&to=${encodeURIComponent(dateTo)}&loc=${encodeURIComponent(
                      location.trim(),
                    )}`,
                  );
                },
              },
            },
          );
        } else if (hasIssuedLetters) {
          toast.success("Override saved", {
            description:
              "Letters are already issued. Generate a fresh letter from Communicate if this window needs its own coverage.",
            duration: 8000,
          });
        } else {
          toast.success("Override saved · next letter will use it");
        }
      } else {
        toast.error(res.error ?? "Couldn't add override");
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal
      onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 24, 0.55)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
          background: "var(--fm-surface, #fff)",
          border: "1px solid var(--fm-border-light, #E5E2DD)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
          padding: "22px 24px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <header style={{ display: "grid", gap: 4 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              color: "var(--fm-primary, #FF6B35)",
            }}
          >
            Add override
          </div>
          <h3
            style={{
              margin: 0,
              fontFamily:
                "var(--fm-font-display, Libre Baskerville, Georgia, serif)",
              fontSize: 22,
              lineHeight: 1.2,
              color: "var(--fm-text, #1A1A1A)",
            }}
          >
            Travel, festival, illness, or plateau break
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--fm-text-2, #5A5A5A)",
            }}
          >
            Set this BEFORE you generate the next letter. The meal plan
            auto-applies it to weeks overlapping these dates — you never
            re-type the destination or dates.
          </p>
        </header>

        <Field label="Dates" help="Inclusive. Maps to protocol weeks automatically.">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={inputStyle}
            />
            <span style={{ color: "var(--fm-text-3)" }}>→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field
          label="Context"
          help="Travel triggers localised meal swaps. Festival relaxes restrictions. Illness skips structure."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(
              [
                ["travel", "✈ Travel"],
                ["festival", "🎉 Festival"],
                ["illness", "🤒 Illness"],
                ["plateau_break", "⏸ Plateau break"],
                ["other", "Other"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setContext(k)}
                disabled={pending}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    context === k ? "var(--fm-primary, #FF6B35)" : "transparent",
                  color: context === k ? "#fff" : "var(--fm-text-secondary, #5A5A5A)",
                  border: "1px solid var(--fm-border, #E5E2DD)",
                  borderRadius: 999,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </Field>

        {context === "travel" && (
          <Field
            label="Destination"
            help="City + country. Letter swaps to local cuisine + restaurant guidance for these dates."
          >
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sydney, Australia"
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Mode">
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                ["maintenance", "Maintenance"],
                ["deeper_deficit", "Deeper deficit"],
                ["skip", "Skip"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                disabled={pending}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    mode === k ? "var(--fm-primary, #FF6B35)" : "transparent",
                  color: mode === k ? "#fff" : "var(--fm-text-secondary, #5A5A5A)",
                  border: "1px solid var(--fm-border, #E5E2DD)",
                  borderRadius: 6,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </Field>

        {mode === "deeper_deficit" && (
          <Field
            label="Calorie offset"
            help="Negative for tighter deficit."
          >
            <input
              type="number"
              value={kcalOffset}
              onChange={(e) => setKcalOffset(e.target.value)}
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Coach note" help="Free-text sticky note.">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              context === "travel"
                ? "work trip — restaurant heavy"
                : context === "festival"
                  ? "Diwali week"
                  : "extra context"
            }
            style={inputStyle}
          />
        </Field>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid var(--fm-border-light, #E5E2DD)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--fm-border, #E5E2DD)",
              borderRadius: 8,
              fontSize: 13,
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            style={{
              padding: "8px 16px",
              background: "var(--fm-primary, #FF6B35)",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.55 : 1,
            }}
          >
            {pending ? "Saving…" : "Add override"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 13,
  background: "var(--fm-surface, #fff)",
  border: "1px solid var(--fm-border, #E5E2DD)",
  borderRadius: 6,
  fontFamily: "inherit",
};

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "var(--fm-text-3, #999)",
        }}
      >
        {label}
      </label>
      {children}
      {help && (
        <div style={{ fontSize: 11, color: "var(--fm-text-3, #999)" }}>
          {help}
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}
