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
import { quickEditActivePlanPractice, listSomaticPractices, type SomaticOption } from "@/lib/server-actions/plan-lifecycle";
import { PracticeAddresses } from "@/components/plan-editor/practice-addresses";
import { ExerciseSessionEditor } from "@/components/plan-editor/exercise-session-editor";
import { phaseOpensAtWeek, type PlanPriorities } from "@/lib/fmdb/practice-phasing";
import { useEffect } from "react";

export interface QuickEditPracticeRow {
  /** catalogue somatic_practice slug, when the practice is a guided session */
  somatic_practice?: string;
  name: string;
  cadence: string;
  details?: string;
  /** which layer of the plan the client meets this in; null/1 = day one */
  phase?: number | null;
  /** driver/topic slugs this practice works on */
  addresses?: string[];
  /** the exercise session on this row, when it carries one */
  exercises?: { exercise: string; level?: string | null; note?: string }[];
}

interface Props {
  planSlug: string;
  /** whose record the exercise options are screened against */
  clientId?: string;
  practices: QuickEditPracticeRow[];
  /** the plan's ranked drivers + topics — the options for "works on" */
  priorities?: PlanPriorities;
  /** plan_period_weeks — decides which week each phase lands on */
  totalWeeks?: number;
  /** false on draft/ready plans — show read-only (drafts edit in the full
   *  plan editor; quick-edit only mutates a published plan). Default true. */
  editable?: boolean;
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

export function QuickEditPracticesPanel({ planSlug, clientId, practices, priorities, totalWeeks = 12, editable = true, embedded }: Props) {
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
          clientId={clientId}
          row={p}
          index={i}
          duplicateOf={dupFlags.get(i) ?? null}
          priorities={priorities}
          totalWeeks={totalWeeks}
        />
      ))}
      <AddPracticeRow planSlug={planSlug} />
    </div>
  );

  if (embedded) return body;

  const dupCount = dupFlags.size;
  return (
    <FmPanel
      title={`🌿 Lifestyle practices (${practices.length})`}
      subtitle="Daily / weekly habits the client commits to — what they see in the app."
      rightSlot={
        editable ? (
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: open ? "var(--fm-text-secondary)" : "var(--fm-primary)",
              cursor: "pointer",
              background: "transparent",
              border: 0,
              fontFamily: "inherit",
            }}
          >
            {open ? "✓ Done" : "✏️ Edit"}
          </button>
        ) : undefined
      }
    >
      {open && editable ? (
        body
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {practices.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
              No practices set.
            </p>
          ) : (
            practices.map((p, i) => (
              <PracticeReadRow
                key={`${i}-${p.name}`}
                name={p.name}
                when={p.cadence}
                duplicateOf={dupFlags.get(i) ?? null}
              />
            ))
          )}
          {dupCount > 0 && editable && (
            <p style={{ fontSize: 11, color: "#b87a0a", margin: "2px 0 0", fontWeight: 600 }}>
              ⚠ {dupCount} possible duplicate{dupCount === 1 ? "" : "s"} — click ✏️ Edit to review.
            </p>
          )}
        </div>
      )}
    </FmPanel>
  );
}

/** Glanceable read row — matches the protocol-column Row styling. */
function PracticeReadRow({
  name,
  when,
  duplicateOf,
}: {
  name: string;
  when: string;
  duplicateOf: string | null;
}) {
  return (
    <div
      style={{
        padding: "7px 10px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fm-text-primary)" }}>
        {name}
        {duplicateOf && (
          <span
            title={`Looks like a duplicate of "${duplicateOf}"`}
            style={{ marginLeft: 6, color: "#b87a0a", fontSize: 11 }}
          >
            ⚠
          </span>
        )}
      </div>
      {when && (
        <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 1 }}>{when}</div>
      )}
    </div>
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
  clientId,
  row,
  index,
  duplicateOf,
  priorities,
  totalWeeks,
}: {
  planSlug: string;
  clientId?: string;
  row: QuickEditPracticeRow;
  index: number;
  duplicateOf: string | null;
  priorities?: PlanPriorities;
  totalWeeks: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(row.name);
  const [cadence, setCadence] = useState(row.cadence);
  const [details, setDetails] = useState(row.details ?? "");
  const [somatic, setSomatic] = useState(row.somatic_practice ?? "");
  const [phase, setPhase] = useState<number>(row.phase && row.phase > 1 ? row.phase : 1);
  const [addresses, setAddresses] = useState<string[]>(row.addresses ?? []);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [exercises, setExercises] = useState<
    { exercise: string; level?: string | null; note?: string }[]
  >(row.exercises ?? []);

  // A reorder is a change, so the comparison is order-sensitive.
  const exKey = (
    xs: { exercise: string; level?: string | null }[],
  ) => xs.map((e) => `${e.exercise}@${e.level ?? ""}`).join("|");

  const dirty =
    name.trim() !== row.name ||
    cadence.trim() !== row.cadence ||
    details.trim() !== (row.details ?? "").trim() ||
    somatic !== (row.somatic_practice ?? "") ||
    phase !== (row.phase && row.phase > 1 ? row.phase : 1) ||
    addresses.join("|") !== (row.addresses ?? []).join("|") ||
    exKey(exercises) !== exKey(row.exercises ?? []);

  const onSave = () => {
    if (!dirty || !name.trim()) return;
    start(async () => {
      const r = await quickEditActivePlanPractice(planSlug, {
        index,
        originalName: row.name,
        name: name.trim(),
        cadence: cadence.trim(),
        details: details.trim(),
        somatic_practice: somatic,
        phase,
        addresses,
        exercises,
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
      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>
          Instructions{" "}
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
            — what the client reads under &quot;How&quot; on their app
          </span>
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          disabled={pending}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
          placeholder="Full instructions — dose/timing/technique, written directly to the client."
        />
      </div>

      {/* WHEN the client meets this, and WHAT it is for. Both live here rather
          than only in the draft editor because a plan is normally already
          published by the time its load is felt — and the draft editor refuses
          published writes, so a live client could otherwise never be staged. */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>Client meets this</label>
          <select
            value={String(phase)}
            disabled={pending}
            onChange={(e) => setPhase(Number(e.target.value))}
            style={{ ...inputStyle, width: "auto", minWidth: 130 }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "From day 1" : `Week ${phaseOpensAtWeek(n, totalWeeks)}`}
              </option>
            ))}
          </select>
        </div>
        {priorities && (
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <PracticeAddresses
              value={addresses}
              priorities={priorities}
              locked={pending}
              onChange={setAddresses}
            />
          </div>
        )}
      </div>
      <SomaticPicker value={somatic} onChange={setSomatic} disabled={pending} />
      {/* The same editor the draft plan editor uses, not a second one — a
          published plan is exactly where a level needs changing, and two
          implementations of "pick an exercise" would drift. */}
      <ExerciseSessionEditor
        clientId={clientId}
        value={exercises}
        locked={pending}
        onChange={setExercises}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {dirty && (
          <button onClick={onSave} disabled={pending} style={{ ...btn, background: "var(--fm-primary)", color: "#fff", border: 0 }}>
            {pending ? "Saving…" : "Save change"}
          </button>
        )}
        {dirty && (
          <button
            onClick={() => { setName(row.name); setCadence(row.cadence); setDetails(row.details ?? ""); }}
            disabled={pending}
            style={btn}
          >
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

/**
 * Link a practice to a catalogue somatic practice.
 *
 * When linked, the client app resolves it BY SLUG and plays the real timed
 * steps. Unlinked practices fall back to name pattern-matching, which cannot
 * tell a specific practice from a generic one — so linking is what turns a
 * written instruction into a guided session.
 */
function SomaticPicker({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [opts, setOpts] = useState<SomaticOption[]>([]);
  useEffect(() => {
    let live = true;
    listSomaticPractices().then((o) => { if (live) setOpts(o); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const sel = opts.find((o) => o.slug === value);
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={labelStyle}>
        Guided session{" "}
        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
          — plays the real timed steps in the app instead of just text
        </span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || opts.length === 0}
        style={{ ...inputStyle, cursor: "pointer" }}
      >
        <option value="">Not guided — instructions only</option>
        {opts.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}{o.seconds ? ` · ${Math.round(o.seconds / 60)} min` : ""}
          </option>
        ))}
      </select>
      {sel && (
        <div style={{ fontSize: 11, color: "var(--fm-muted)", marginTop: 4 }}>
          Plays as <strong>{sel.shape.replace(/_/g, " ")}</strong>
          {sel.region ? ` · ${sel.region.replace(/_/g, " ")}` : ""}
        </div>
      )}
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
      <p style={{ fontSize: 11, color: "var(--fm-text-tertiary)", margin: "0 0 8px", lineHeight: 1.45 }}>
        💡 Tip: name a breathing practice <strong>“4-7-8 breathing”</strong>, <strong>“Box breathing”</strong> or{" "}
        <strong>“Extended exhale breathing”</strong> (optionally <em>“— 5 rounds”</em>) and the client&apos;s app
        shows a guided animation paced to it.
      </p>
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
