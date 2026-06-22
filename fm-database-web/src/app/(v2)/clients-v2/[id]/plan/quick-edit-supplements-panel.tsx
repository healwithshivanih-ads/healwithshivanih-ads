"use client";

/**
 * QuickEditSupplementsPanel — lightweight in-place editor for the
 * supplement protocol of a PUBLISHED plan.
 *
 * Published plans are normally frozen — the formal way to change one is
 * createSuccessor → publish → supersede (4 steps). That's right for a
 * protocol pivot, but overkill for a trivial mid-plan tweak like
 * "drop omega-3 to 1 g". This panel does the small edit directly:
 *
 *   - Adjust a supplement's dose and/or timing
 *   - Remove a supplement entirely
 *
 * Each save calls quickEditActivePlanSupplement, which mutates the
 * published YAML in place, appends a status_history audit line, and
 * bumps updated_at. Future phase letters + meal plans regenerate from
 * the live plan, so the change flows into every further letter; the
 * letter-staleness detector flags any already-sent letters with a
 * "regenerate" prompt on the Communicate tab.
 *
 * Shown ONLY for published plans (drafts are edited in the full editor).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { quickEditActivePlanSupplement } from "@/lib/server-actions/plan-lifecycle";
import { supplementDisplayName } from "@/lib/fmdb/supplement-display";

interface SupplementRow {
  slug: string;
  displayName?: string;
  dose: string;
  timing: string;
}

export type QuickEditSupplementRow = SupplementRow;

interface Props {
  planSlug: string;
  supplements: SupplementRow[];
  /** catalogue supplements for the add-supplement typeahead */
  catalogueOptions?: { value: string; label: string }[];
  /** bare rows, no FmPanel chrome, always open — used inside the Plan
   *  tab's "What the client sees" studio (surfaces merged 2026-06-12) */
  embedded?: boolean;
}

export function QuickEditSupplementsPanel({ planSlug, supplements, catalogueOptions, embedded }: Props) {
  const [open, setOpen] = useState(false);

  if (embedded) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {supplements.map((s) => (
          <QuickEditRow key={s.slug} planSlug={planSlug} row={s} />
        ))}
        <QuickAddRow planSlug={planSlug} existingSlugs={supplements.map((s) => s.slug)} catalogueOptions={catalogueOptions} />
      </div>
    );
  }

  return (
    <FmPanel
      title="✏️ Quick edit supplements"
      subtitle="Add a supplement, adjust a dose or timing, or remove one — without rebuilding the plan. Changes flow into all future letters; already-sent letters get a regenerate prompt."
      rightSlot={
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            fontSize: 11,
            color: "var(--fm-primary)",
            textDecoration: "underline",
            cursor: "pointer",
            background: "transparent",
            border: 0,
            fontFamily: "inherit",
          }}
        >
          {open ? "Close" : "Open editor"}
        </button>
      }
    >
      {!open ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            margin: 0,
          }}
        >
          {supplements.length} supplement{supplements.length === 1 ? "" : "s"} on
          this plan. Click <strong>Open editor</strong> to tweak a dose or timing
          in place.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {supplements.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
              No supplements on this plan.
            </p>
          )}
          {supplements.map((s) => (
            <QuickEditRow key={s.slug} planSlug={planSlug} row={s} />
          ))}
          <QuickAddRow planSlug={planSlug} existingSlugs={supplements.map((s) => s.slug)} catalogueOptions={catalogueOptions} />
        </div>
      )}
    </FmPanel>
  );
}

function QuickEditRow({
  planSlug,
  row,
}: {
  planSlug: string;
  row: SupplementRow;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dose, setDose] = useState(row.dose);
  const [timing, setTiming] = useState(row.timing);
  const [reason, setReason] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const dirty = dose.trim() !== row.dose || timing.trim() !== row.timing;
  const name = supplementDisplayName({
    display_name: row.displayName,
    slug: row.slug,
  });

  const onSave = () => {
    if (!dirty) return;
    start(async () => {
      const r = await quickEditActivePlanSupplement(planSlug, row.slug, {
        dose: dose.trim(),
        timing: timing.trim(),
        reason: reason.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (!r.changed) {
        toast.info("No change to save");
        return;
      }
      toast.success(`✏️ ${name} updated`);
      setReason("");
      router.refresh();
    });
  };

  const onRemove = () => {
    start(async () => {
      const r = await quickEditActivePlanSupplement(planSlug, row.slug, {
        remove: true,
        reason: reason.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`🗑 ${name} removed from plan`);
      router.refresh();
    });
  };

  const inputStyle: React.CSSProperties = {
    fontSize: 11.5,
    padding: "4px 8px",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    marginBottom: 2,
    display: "block",
  };
  const btn: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: "5px 12px",
    borderRadius: "var(--fm-radius-sm)",
    cursor: pending ? "wait" : "pointer",
    fontFamily: "inherit",
    border: "1px solid var(--fm-border)",
    background: "var(--fm-surface)",
    color: "var(--fm-text-secondary)",
  };

  return (
    <div
      style={{
        padding: "10px 12px",
        background: dirty ? "rgba(184, 119, 10, 0.06)" : "var(--fm-bg-cool)",
        border: `1px solid ${
          dirty ? "rgba(184, 119, 10, 0.40)" : "var(--fm-border)"
        }`,
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--fm-text-primary)",
          marginBottom: 8,
        }}
      >
        {name}
        <span
          style={{
            fontFamily: "var(--fm-font-mono)",
            fontSize: 10,
            color: "var(--fm-text-tertiary)",
            fontWeight: 400,
            marginLeft: 6,
          }}
        >
          {row.slug}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <label style={labelStyle}>Dose</label>
          <input
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            disabled={pending}
            style={inputStyle}
            placeholder="e.g. 1000 mg EPA+DHA daily"
          />
        </div>
        <div>
          <label style={labelStyle}>Timing</label>
          <input
            value={timing}
            onChange={(e) => setTiming(e.target.value)}
            disabled={pending}
            style={inputStyle}
            placeholder="e.g. With main meal"
          />
        </div>
      </div>

      {(dirty || confirmRemove) && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={pending}
          style={{ ...inputStyle, marginBottom: 8 }}
          placeholder="Reason (optional — recorded in the plan audit trail)"
        />
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {dirty && (
          <button
            onClick={onSave}
            disabled={pending}
            style={{
              ...btn,
              background: "var(--fm-primary)",
              color: "#fff",
              border: 0,
            }}
          >
            {pending ? "Saving…" : "Save change"}
          </button>
        )}
        {dirty && (
          <button
            onClick={() => {
              setDose(row.dose);
              setTiming(row.timing);
              setReason("");
            }}
            disabled={pending}
            style={btn}
          >
            Cancel
          </button>
        )}
        <div style={{ marginLeft: "auto" }}>
          {!confirmRemove ? (
            <button
              onClick={() => setConfirmRemove(true)}
              disabled={pending}
              style={{ ...btn, color: "#c0392b" }}
            >
              🗑 Remove
            </button>
          ) : (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 600 }}>
                Remove {name}?
              </span>
              <button
                onClick={onRemove}
                disabled={pending}
                style={{
                  ...btn,
                  background: "#c0392b",
                  color: "#fff",
                  border: 0,
                }}
              >
                {pending ? "Removing…" : "Yes, remove"}
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                disabled={pending}
                style={btn}
              >
                Keep
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Add a brand-new supplement to the published plan in place. The display name
 *  drives both the client-facing label and the buy-link name-match against
 *  supplement_links.yaml; the slug is derived from it. */
function QuickAddRow({
  planSlug,
  existingSlugs,
  catalogueOptions = [],
}: {
  planSlug: string;
  existingSlugs: string[];
  catalogueOptions?: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // When the coach picks a catalogue entry we keep its slug; freeform names
  // fall back to a slugified name. Editing the name clears the catalogue pick.
  const [chosenSlug, setChosenSlug] = useState("");
  const [showOpts, setShowOpts] = useState(false);
  const [dose, setDose] = useState("");
  const [timing, setTiming] = useState("");
  const [startWeek, setStartWeek] = useState("1");
  const [why, setWhy] = useState("");

  const slug =
    chosenSlug ||
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const q = name.trim().toLowerCase();
  const matches =
    q.length === 0
      ? catalogueOptions.slice(0, 8)
      : catalogueOptions
          .filter(
            (o) =>
              o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
          )
          .slice(0, 8);
  const exactCatalogueMatch = catalogueOptions.some(
    (o) => o.label.toLowerCase() === q || o.value === slug,
  );

  const inputStyle: React.CSSProperties = {
    fontSize: 11.5,
    padding: "4px 8px",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    marginBottom: 2,
    display: "block",
  };

  const onAdd = () => {
    if (!slug) {
      toast.error("Enter a supplement name");
      return;
    }
    if (existingSlugs.includes(slug)) {
      toast.error("That supplement is already on the plan");
      return;
    }
    start(async () => {
      const r = await quickEditActivePlanSupplement(planSlug, slug, {
        add: true,
        displayName: name.trim(),
        dose: dose.trim(),
        timing: timing.trim(),
        startWeek: Math.max(1, parseInt(startWeek, 10) || 1),
        coachRationale: why.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`➕ ${name.trim()} added to plan`);
      setName("");
      setChosenSlug("");
      setDose("");
      setTiming("");
      setStartWeek("1");
      setWhy("");
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          fontWeight: 700,
          padding: "8px 12px",
          borderRadius: "var(--fm-radius-sm)",
          border: "1px dashed var(--fm-primary)",
          background: "transparent",
          color: "var(--fm-primary)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ➕ Add a supplement
      </button>
    );
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(47, 125, 79, 0.06)",
        border: "1px solid rgba(47, 125, 79, 0.40)",
        borderRadius: "var(--fm-radius-sm)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
        ➕ New supplement
      </div>
      <div style={{ position: "relative" }}>
        <label style={labelStyle}>Name — search the catalogue or type a custom one</label>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setChosenSlug(""); // typing means it's no longer a picked catalogue entry
            setShowOpts(true);
          }}
          onFocus={() => setShowOpts(true)}
          onBlur={() => setTimeout(() => setShowOpts(false), 150)}
          placeholder="e.g. Magnesium Glycinate"
          autoComplete="off"
        />
        {showOpts && matches.length > 0 && (
          <div
            style={{
              position: "absolute",
              zIndex: 20,
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 2,
              maxHeight: 200,
              overflowY: "auto",
              background: "var(--fm-surface)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            }}
          >
            {matches.map((o) => (
              <button
                key={o.value}
                // onMouseDown (not onClick) so it fires before the input's blur
                onMouseDown={(e) => {
                  e.preventDefault();
                  setName(o.label);
                  setChosenSlug(o.value);
                  setShowOpts(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 12,
                  background: "transparent",
                  border: 0,
                  borderBottom: "1px solid var(--fm-border)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "var(--fm-text-primary)",
                }}
              >
                {o.label}
                <span style={{ fontFamily: "var(--fm-font-mono)", fontSize: 9.5, color: "var(--fm-text-tertiary)", marginLeft: 6 }}>
                  {o.value}
                </span>
              </button>
            ))}
          </div>
        )}
        {slug && (
          <div style={{ fontSize: 10, color: "var(--fm-text-tertiary)", marginTop: 2, fontFamily: "var(--fm-font-mono)" }}>
            slug: {slug}
            {exactCatalogueMatch ? (
              <span style={{ color: "#2f7d4f", fontFamily: "inherit", fontWeight: 600 }}> · ✓ in catalogue</span>
            ) : (
              <span style={{ color: "var(--fm-text-tertiary)", fontFamily: "inherit" }}> · custom</span>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 8 }}>
        <div>
          <label style={labelStyle}>Dose</label>
          <input style={inputStyle} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="200–400 mg" />
        </div>
        <div>
          <label style={labelStyle}>Timing</label>
          <input style={inputStyle} value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="evening" />
        </div>
        <div>
          <label style={labelStyle}>Start wk</label>
          <input style={inputStyle} value={startWeek} onChange={(e) => setStartWeek(e.target.value)} inputMode="numeric" />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Why (coach rationale — optional)</label>
        <input style={inputStyle} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Sleep + stress support" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onAdd}
          disabled={pending}
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "5px 14px",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            border: "1px solid var(--fm-primary)",
            background: "var(--fm-primary)",
            color: "#fff",
          }}
        >
          {pending ? "Adding…" : "Add to plan"}
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "5px 12px",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
            border: "1px solid var(--fm-border)",
            background: "var(--fm-surface)",
            color: "var(--fm-text-secondary)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
