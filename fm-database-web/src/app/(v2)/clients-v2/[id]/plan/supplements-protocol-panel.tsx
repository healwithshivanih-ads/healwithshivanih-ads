"use client";

/**
 * SupplementsProtocolPanel — the single supplements surface on the Plan tab.
 *
 * Shows the rich read display (FmSupplementGrid — timing bubbles + click-to-
 * read rationale) by default, with an "✏️ Edit" toggle that swaps to the
 * in-place quick editor (dose / timing / remove) for a PUBLISHED plan. This
 * replaces the old split where supplements were read-only in the protocol
 * column AND separately editable inside the App-preview studio — one surface
 * now, in the protocol column.
 */

import { useState } from "react";
import { FmPanel, FmSupplementGrid } from "@/components/fm";
import {
  QuickEditSupplementsPanel,
  type QuickEditSupplementRow,
} from "./quick-edit-supplements-panel";

export interface SupplementScheduleRow {
  name: string;
  dose: string;
  timing: string;
  startWeek: number;
  durationWeeks: number | null;
}

interface Props {
  planSlug: string;
  gridItems: React.ComponentProps<typeof FmSupplementGrid>["items"];
  editRows: QuickEditSupplementRow[];
  /** Every supplement in the protocol, for the "by start week" schedule list. */
  scheduleRows?: SupplementScheduleRow[];
  /** Catalogue supplements for the add-supplement typeahead. */
  catalogueOptions?: { value: string; label: string }[];
  /** false on draft/ready plans (drafts edit in the full plan editor). */
  editable?: boolean;
  /** Chromeless mode for the Plan studio accordion — drop the outer FmPanel
   *  (title/subtitle) so the section's own header is the single heading; the
   *  ✏️ Edit toggle moves into the body. Keeps every studio section uniform. */
  embedded?: boolean;
}

/** All supplements grouped by the week they start — the full phased arc, in
 *  chronological order. Coach-facing (the client app phase-gates to the current
 *  week; this shows the whole plan). */
function ScheduleByWeek({ rows }: { rows: SupplementScheduleRow[] }) {
  const groups = new Map<number, SupplementScheduleRow[]>();
  for (const r of rows) {
    const wk = r.startWeek || 1;
    if (!groups.has(wk)) groups.set(wk, []);
    groups.get(wk)!.push(r);
  }
  const weeks = [...groups.keys()].sort((a, b) => a - b);
  const weekLabel = (wk: number) => (wk <= 1 ? "From Day 1 · Week 1" : `From Week ${wk}`);
  const endLabel = (r: SupplementScheduleRow) =>
    r.durationWeeks && r.durationWeeks > 0
      ? `weeks ${r.startWeek || 1}–${(r.startWeek || 1) + r.durationWeeks - 1}`
      : "ongoing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {weeks.map((wk) => (
        <div key={wk}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--fm-primary)",
              marginBottom: 6,
            }}
          >
            {weekLabel(wk)}{" "}
            <span style={{ color: "var(--fm-text-secondary)", fontWeight: 600 }}>
              · {groups.get(wk)!.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {groups.get(wk)!.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "2px 10px",
                  paddingBottom: 6,
                  borderBottom: "1px solid var(--fm-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--fm-text-primary)" }}>
                  {r.name}
                </span>
                {r.dose && (
                  <span style={{ fontSize: 12, color: "var(--fm-text-primary)" }}>{r.dose}</span>
                )}
                {r.timing && (
                  <span style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>· {r.timing}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginLeft: "auto" }}>
                  {endLabel(r)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SupplementsProtocolPanel({
  planSlug,
  gridItems,
  editRows,
  scheduleRows,
  catalogueOptions,
  editable = true,
  embedded,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<"week" | "time">("week");
  const count = Array.isArray(gridItems) ? gridItems.length : 0;
  const hasSchedule = !!scheduleRows && scheduleRows.length > 0;

  const linkBtn = (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: active ? "var(--fm-primary)" : "var(--fm-text-secondary)",
    cursor: "pointer",
    background: "transparent",
    border: 0,
    fontFamily: "inherit",
    padding: 0,
  });

  const viewToggle =
    !editing && hasSchedule ? (
      <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => setView("week")} style={linkBtn(view === "week")}>
          📅 By week
        </button>
        <button onClick={() => setView("time")} style={linkBtn(view === "time")}>
          🕐 By time
        </button>
      </span>
    ) : null;

  const editToggle = editable ? (
    <button
      onClick={() => setEditing((v) => !v)}
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: editing ? "var(--fm-text-secondary)" : "var(--fm-primary)",
        cursor: "pointer",
        background: "transparent",
        border: 0,
        fontFamily: "inherit",
      }}
    >
      {editing ? "✓ Done" : "✏️ Edit"}
    </button>
  ) : undefined;

  const controls =
    viewToggle || editToggle ? (
      <span style={{ display: "inline-flex", gap: 14, alignItems: "center" }}>
        {viewToggle}
        {editToggle}
      </span>
    ) : undefined;

  const body =
    editing && editable ? (
      <QuickEditSupplementsPanel
        planSlug={planSlug}
        supplements={editRows}
        catalogueOptions={catalogueOptions}
        embedded
      />
    ) : hasSchedule && view === "week" ? (
      <ScheduleByWeek rows={scheduleRows!} />
    ) : (
      <FmSupplementGrid items={gridItems} />
    );

  if (embedded) {
    return (
      <div>
        {controls && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            {controls}
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <FmPanel
      title={`💊 Supplements (${count})`}
      subtitle="Every supplement in the plan, grouped by the week it starts. Switch to 🕐 By time for the daily timing view; ✏️ Edit to adjust dose / timing."
      rightSlot={controls}
    >
      {body}
    </FmPanel>
  );
}
