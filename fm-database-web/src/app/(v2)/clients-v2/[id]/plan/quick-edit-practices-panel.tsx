"use client";

/**
 * QuickEditPracticesPanel — in-place add / edit / remove of the daily
 * lifestyle practices on a PUBLISHED plan (the same posture as
 * QuickEditSupplementsPanel).
 *
 * Why this exists: published plans are frozen, and practices accumulate
 * near-duplicates when rework / follow-up generation appends a similarly-
 * worded practice (e.g. "10-minute post-meal walk" + "10-min walk after
 * every meal"). The companion app renders the list verbatim, so the client
 * sees repeats — and the coach previously had no way to fix it without the
 * full createSuccessor→publish→supersede dance. This panel lets the coach
 * curate the list directly: rename, retime, remove, or add a practice.
 *
 * Each action calls quickEditActivePlanPractice, which mutates the published
 * YAML in place + records an audit line. Likely duplicates are flagged so the
 * coach can spot-and-remove them; nothing is auto-deleted.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { quickEditActivePlanPractice } from "@/lib/server-actions/plan-lifecycle";

export interface QuickEditPracticeRow {
  name: string;
  cadence: string;
  details?: string;
}

interface Props {
  planSlug: string;
  practices: QuickEditPracticeRow[];
  embedded?: boolean;
}

const FILLERS = new Set([
  "the", "a", "an", "or", "and", "of", "to", "per", "every", "after", "before",
  "min", "mins", "minute", "minutes", "x", "daily", "nightly", "times", "time",
  "week", "weekly", "day", "with", "your", "for", "on",
]);

/** content-token set for a practice name (drops parentheticals, trailing
 *  "— explanation", punctuation, and filler words) */
function tokenSet(name: string): Set<string> {
  const s = (name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[—–-]\s.*$/g, " ") // trailing "— rationale"
    .replace(/[^a-z0-9 ]/g, " ");
  return new Set(s.split(/\s+/).filter((t) => t && t.length > 1 && !FILLERS.has(t)));
}

/** Jaccard overlap of two names' content tokens. */
function similarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** indices that look like duplicates of an EARLIER row (>=0.5 overlap) */
function duplicateFlags(practices: QuickEditPracticeRow[]): Map<number, string> {
  const flags = new Map<number, string>();
  for (let i = 0; i < practices.length; i++) {
    for (let j = 0; j < i; j++) {
      if (similarity(practices[i].name, practices[j].name) >= 0.5) {
        flags.set(i, practices[j].name);
        break;
      }
    }
  }
  return flags;
}

export function QuickEditPracticesPanel({ planSlug, practices, embedded }: Props) {
  const [open, setOpen] = useState(false);
  const dupFlags = duplicateFlags(practices);

  const body = (
    <div style={{ display: "grid", gap: 8 }}>
      {practices.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
          No daily practices on this plan yet.
        </p>
      )}
      {practices.map((p, i) => (
        <PracticeRow
          key={`${i}-${p.name}`}
          planSlug={planSlug}
          row={p}
          index={i}
          duplicateOf={dupFlags.get(i) ?? null}
        />
      ))}
      <AddPracticeRow planSlug={planSlug} />
    </div>
  );

  if (embedded) return body;

  const dupCount = dupFlags.size;
  return (
    <FmPanel
      title="🌱 Daily practices"
      subtitle="Add, rename, retime or remove the practices the client sees in the app — without rebuilding the plan. Each change is saved to the live plan and audited."
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
        <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
          {practices.length} practice{practices.length === 1 ? "" : "s"} on this plan
          {dupCount > 0 && (
            <span style={{ color: "#b87a0a", fontWeight: 600 }}>
              {" "}· {dupCount} possible duplicate{dupCount === 1 ? "" : "s"} flagged
            </span>
          )}
          . Click <strong>Open editor</strong> to curate the list.
        </p>
      ) : (
        body
      )}
    </FmPanel>
  );
}

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

function PracticeRow({
  planSlug,
  row,
  index,
  duplicateOf,
}: {
  planSlug: string;
  row: QuickEditPracticeRow;
  index: number;
  duplicateOf: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(row.name);
  const [cadence, setCadence] = useState(row.cadence);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const dirty = name.trim() !== row.name || cadence.trim() !== row.cadence;

  const onSave = () => {
    if (!dirty || !name.trim()) return;
    start(async () => {
      const r = await quickEditActivePlanPractice(planSlug, {
        index,
        originalName: row.name,
        name: name.trim(),
        cadence: cadence.trim(),
      });
      if (!r.ok) return void toast.error(r.error);
      if (!r.changed) return void toast.info("No change to save");
      toast.success("✏️ Practice updated");
      router.refresh();
    });
  };

  const onRemove = () => {
    start(async () => {
      const r = await quickEditActivePlanPractice(planSlug, {
        index,
        originalName: row.name,
        remove: true,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`🗑 Removed "${row.name}"`);
      router.refresh();
    });
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
        background: duplicateOf
          ? "rgba(184, 122, 10, 0.08)"
          : dirty
            ? "rgba(184, 119, 10, 0.06)"
            : "var(--fm-bg-cool)",
        border: `1px solid ${duplicateOf ? "rgba(184,122,10,0.5)" : dirty ? "rgba(184, 119, 10, 0.40)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      {duplicateOf && (
        <div style={{ fontSize: 11, color: "#b87a0a", fontWeight: 600, marginBottom: 6 }}>
          ⚠ Looks like a duplicate of “{duplicateOf}” — remove if it&apos;s a repeat.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>Practice</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>When / cadence</label>
          <input value={cadence} onChange={(e) => setCadence(e.target.value)} disabled={pending} style={inputStyle} placeholder="e.g. daily, after meals" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {dirty && (
          <button onClick={onSave} disabled={pending} style={{ ...btn, background: "var(--fm-primary)", color: "#fff", border: 0 }}>
            {pending ? "Saving…" : "Save change"}
          </button>
        )}
        {dirty && (
          <button onClick={() => { setName(row.name); setCadence(row.cadence); }} disabled={pending} style={btn}>
            Cancel
          </button>
        )}
        <div style={{ marginLeft: "auto" }}>
          {!confirmRemove ? (
            <button onClick={() => setConfirmRemove(true)} disabled={pending} style={{ ...btn, color: "#c0392b" }}>
              🗑 Remove
            </button>
          ) : (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#c0392b", fontWeight: 600 }}>Remove?</span>
              <button onClick={onRemove} disabled={pending} style={{ ...btn, background: "#c0392b", color: "#fff", border: 0 }}>
                {pending ? "Removing…" : "Yes"}
              </button>
              <button onClick={() => setConfirmRemove(false)} disabled={pending} style={btn}>
                Keep
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AddPracticeRow({ planSlug }: { planSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("daily");

  const onAdd = () => {
    if (!name.trim()) return;
    start(async () => {
      const r = await quickEditActivePlanPractice(planSlug, {
        add: true,
        name: name.trim(),
        cadence: cadence.trim() || "daily",
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`➕ Added "${name.trim()}"`);
      setName("");
      setCadence("daily");
      setAdding(false);
      router.refresh();
    });
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "8px 12px",
          borderRadius: "var(--fm-radius-sm)",
          border: "1px dashed var(--fm-border)",
          background: "transparent",
          color: "var(--fm-primary)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ➕ Add a practice
      </button>
    );
  }

  return (
    <div style={{ padding: "10px 12px", background: "var(--fm-bg-cool)", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>New practice</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={pending} style={inputStyle} placeholder="e.g. 10-minute post-meal walk" />
        </div>
        <div>
          <label style={labelStyle}>When / cadence</label>
          <input value={cadence} onChange={(e) => setCadence(e.target.value)} disabled={pending} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onAdd} disabled={pending || !name.trim()} style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: "var(--fm-radius-sm)", border: 0, background: "var(--fm-primary)", color: "#fff", cursor: pending ? "wait" : "pointer", fontFamily: "inherit", opacity: name.trim() ? 1 : 0.5 }}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button onClick={() => { setAdding(false); setName(""); }} disabled={pending} style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: "var(--fm-radius-sm)", border: "1px solid var(--fm-border)", background: "var(--fm-surface)", color: "var(--fm-text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
