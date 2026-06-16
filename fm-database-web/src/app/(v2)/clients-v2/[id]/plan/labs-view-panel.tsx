"use client";

/**
 * LabsViewPanel — coach-facing labs summary on the Plan tab.
 *
 * Two view modes:
 *   - By cadence (default): 🆕 Order now / 🔁 At recheck — flat list,
 *     coach scans by "what do I tell her to order this week vs later"
 *   - By sample type: 🩸 Blood / 💩 Stool / 💧 Urine / 🌬️ Breath / 🧪 Saliva
 *     etc. — grouped first by what the client gives on the day. Within
 *     each sample bucket, "🆕 Order now" stays separate from "🔁 At
 *     recheck (week N)" so she knows which trip is which.
 */

import { useMemo, useState } from "react";
import { FmPanel } from "@/components/fm";
import {
  inferLabSampleType,
  SAMPLE_TYPE_ORDER,
  SAMPLE_TYPE_ICON,
  type SampleType,
} from "@/lib/fmdb/lab-sample-type";
import { LabRequisitionButtons } from "./lab-requisition-buttons";

export interface LabRow {
  label: string;
  detail?: string;
  /** Weeks-from-start the retest is due (repeat labs only). */
  dueInWeeks?: number;
  /** ISO date the retest is due (computed from plan start anchor). */
  dueDate?: string | null;
}

interface Props {
  newLabs: LabRow[];
  repeatLabs: LabRow[];
  /** ISO date the plan effectively started (client-confirmed or fallback). */
  planStartAnchor?: string | null;
  /** True iff the start was confirmed by the client (vs derived). */
  planStartConfirmed?: boolean;
  /** How the anchor was resolved — drives the footer label. */
  planStartSource?: "confirmed" | "supplements" | "letter+3d" | "plan_period" | "none";
  /** Plan slug — needed for the lab requisition send button. */
  planSlug?: string;
  /** Client id — needed for the lab requisition send button. */
  clientId?: string;
  /** Client email — pre-fills the email-to field on the requisition button. */
  clientEmail?: string | null;
  /** Chromeless mode for the Plan studio accordion — drop the outer FmPanel
   *  so the section header is the single heading; the view toggle moves into
   *  the body. Keeps every studio section visually uniform. */
  embedded?: boolean;
}

const SOURCE_LABEL: Record<NonNullable<Props["planStartSource"]>, string> = {
  confirmed: "client-confirmed",
  supplements: "supplements-confirmed",
  "letter+3d": "letter emailed + 3 days (typical adoption lag — confirm with client to lock)",
  plan_period: "derived from plan period",
  none: "—",
};

type DueStatus = "overdue" | "due_soon" | "due_today" | "future" | "no_start";

function statusFor(dueDate: string | null | undefined, hasStart: boolean): DueStatus {
  if (!hasStart) return "no_start";
  if (!dueDate) return "future";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due_today";
  if (diffDays <= 14) return "due_soon";
  return "future";
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type ViewMode = "cadence" | "sample";

const VIEW_LABELS: Record<ViewMode, string> = {
  cadence: "By cadence",
  sample: "By sample type",
};

export function LabsViewPanel({
  newLabs,
  repeatLabs,
  planStartAnchor,
  planStartConfirmed,
  planStartSource = "none",
  planSlug,
  clientId,
  clientEmail,
  embedded,
}: Props) {
  const [mode, setMode] = useState<ViewMode>("cadence");
  const hasStart = Boolean(planStartAnchor);

  // Flag every repeat lab with its due status — drives the row chip + the
  // reminder banner at the top of the panel.
  const repeatLabsTagged = repeatLabs.map((l) => ({
    ...l,
    status: statusFor(l.dueDate, hasStart),
  }));

  const overdueRows = repeatLabsTagged.filter((l) => l.status === "overdue");
  const dueSoonRows = repeatLabsTagged.filter(
    (l) => l.status === "due_today" || l.status === "due_soon",
  );
  const needsReminder = overdueRows.length > 0 || dueSoonRows.length > 0;

  // Bucket every lab by sample type + cadence — both views read from this.
  const bySample = useMemo(() => {
    const out = new Map<SampleType, { newLabs: LabRow[]; repeatLabs: LabRow[] }>();
    const ensure = (k: SampleType) => {
      if (!out.has(k)) out.set(k, { newLabs: [], repeatLabs: [] });
      return out.get(k)!;
    };
    for (const l of newLabs) ensure(inferLabSampleType(l.label)).newLabs.push(l);
    for (const l of repeatLabsTagged) ensure(inferLabSampleType(l.label)).repeatLabs.push(l);
    return out;
  }, [newLabs, repeatLabsTagged]);

  const total = newLabs.length + repeatLabs.length;
  if (total === 0) return null;

  const viewToggle = (
    <div style={{ display: "flex", gap: 4 }}>
      {(Object.keys(VIEW_LABELS) as ViewMode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 999,
              border: active
                ? "1.5px solid var(--fm-primary)"
                : "1px solid var(--fm-border)",
              background: active ? "var(--fm-primary)" : "var(--fm-surface)",
              color: active ? "#fff" : "var(--fm-text-secondary)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {VIEW_LABELS[m]}
          </button>
        );
      })}
    </div>
  );

  const inner = (
    <>
      {/* Reminder banner — only when at least one retest is overdue or due
          within 14 days of today. Falls back to a softer "set start date"
          nudge if the coach hasn't captured meal_plan_started_on yet. */}
      {needsReminder && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            background:
              overdueRows.length > 0
                ? "rgba(220, 38, 38, 0.07)"
                : "rgba(245, 158, 11, 0.08)",
            border:
              overdueRows.length > 0
                ? "1.5px solid rgba(220, 38, 38, 0.45)"
                : "1.5px solid rgba(245, 158, 11, 0.50)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: overdueRows.length > 0 ? "#991b1b" : "#92400e",
              marginBottom: 4,
            }}
          >
            ⏰ Retest reminder
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", lineHeight: 1.5 }}>
            {overdueRows.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: "#991b1b" }}>
                  {overdueRows.length} retest{overdueRows.length === 1 ? "" : "s"} overdue
                </strong>{" "}
                — {overdueRows.map((l) => l.label).slice(0, 3).join(", ")}
                {overdueRows.length > 3 && ` + ${overdueRows.length - 3} more`}.
              </div>
            )}
            {dueSoonRows.length > 0 && (
              <div>
                <strong style={{ color: "#92400e" }}>
                  {dueSoonRows.length} due within 2 weeks
                </strong>{" "}
                — {dueSoonRows.map((l) => `${l.label} (${l.dueDate ? fmtDate(l.dueDate) : "?"})`).slice(0, 3).join(", ")}
                {dueSoonRows.length > 3 && ` + ${dueSoonRows.length - 3} more`}.
              </div>
            )}
            <div style={{ marginTop: 6, color: "var(--fm-text-tertiary)", fontSize: 11 }}>
              Anchored to {SOURCE_LABEL[planStartSource]} start date{" "}
              {planStartAnchor && (
                <span style={{ fontFamily: "var(--fm-font-mono)" }}>{fmtDate(planStartAnchor)}</span>
              )}
              {!planStartConfirmed && planStartSource !== "none" && " — confirm with client to lock."}
            </div>
            {/* Prominent send-requisition buttons — coach's primary action
                when a retest is overdue or imminent. Same flow as the
                always-visible buttons at the bottom of the panel. */}
            {planSlug && clientId && (
              <div style={{ marginTop: 10 }}>
                <LabRequisitionButtons
                  planSlug={planSlug}
                  clientId={clientId}
                  clientEmail={clientEmail}
                  prominent
                />
              </div>
            )}
          </div>
        </div>
      )}

      {!needsReminder && repeatLabs.length > 0 && hasStart && !planStartConfirmed && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            background: "rgba(75, 110, 175, 0.06)",
            border: "1px dashed rgba(75, 110, 175, 0.30)",
            borderRadius: "var(--fm-radius-md)",
            fontSize: 11,
            color: "var(--fm-text-secondary)",
          }}
        >
          ℹ️ Retest dates are estimated from{" "}
          {planStartSource === "letter+3d"
            ? "when the letter was emailed + 3 days adoption lag"
            : planStartSource === "supplements"
              ? "the supplements start date"
              : "the plan period"}
          . Set <strong>meal plan started on</strong> below once the client confirms to lock them.
        </div>
      )}

      {!needsReminder && repeatLabs.length > 0 && !hasStart && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            background: "rgba(75, 110, 175, 0.06)",
            border: "1px dashed rgba(75, 110, 175, 0.30)",
            borderRadius: "var(--fm-radius-md)",
            fontSize: 11,
            color: "var(--fm-text-secondary)",
          }}
        >
          ℹ️ Retest due dates can&apos;t be computed yet — no letter on file
          and no <strong>meal plan started on</strong> set. Generate &amp;
          send a letter, or set the start date manually below.
        </div>
      )}

      {mode === "cadence" && (
        <CadenceView newLabs={newLabs} repeatLabs={repeatLabsTagged} />
      )}
      {mode === "sample" && <SampleView bySample={bySample} />}

      {/* Always-visible footer row with the requisition send buttons —
          quieter styling when no retest is currently due (otherwise the
          prominent version above is shown inside the reminder banner). */}
      {planSlug && clientId && !needsReminder && (newLabs.length > 0 || repeatLabs.length > 0) && (
        <LabRequisitionButtons
          planSlug={planSlug}
          clientId={clientId}
          clientEmail={clientEmail}
        />
      )}
    </>
  );

  if (embedded) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          {viewToggle}
        </div>
        {inner}
      </div>
    );
  }

  return (
    <FmPanel
      title={`🧪 Labs (${total})`}
      subtitle="Group by cadence (when to order) or by sample type (what the client gives on the day)."
      rightSlot={viewToggle}
    >
      {inner}
    </FmPanel>
  );
}

// ── Cadence view (original) ───────────────────────────────────────────────

function CadenceView({
  newLabs,
  repeatLabs,
}: {
  newLabs: LabRow[];
  repeatLabs: (LabRow & { status?: DueStatus })[];
}) {
  return (
    <>
      {newLabs.length > 0 && (
        <div style={{ marginBottom: repeatLabs.length > 0 ? 14 : 0 }}>
          <SectionHeader tone="primary">🆕 Order now ({newLabs.length})</SectionHeader>
          <div style={{ display: "grid", gap: 6 }}>
            {newLabs.map((l, i) => (
              <Row key={`new-${l.label}-${i}`} label={l.label} detail={l.detail} />
            ))}
          </div>
        </div>
      )}
      {repeatLabs.length > 0 && (
        <div>
          <SectionHeader>🔁 At recheck ({repeatLabs.length})</SectionHeader>
          <div style={{ display: "grid", gap: 6 }}>
            {repeatLabs.map((l, i) => (
              <Row
                key={`rep-${l.label}-${i}`}
                label={l.label}
                detail={l.detail}
                dueDate={l.dueDate}
                status={l.status}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Sample-type view — split by cadence inside each sample bucket ─────────

function SampleView({
  bySample,
}: {
  bySample: Map<SampleType, { newLabs: LabRow[]; repeatLabs: LabRow[] }>;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {SAMPLE_TYPE_ORDER.flatMap((kind) => {
        const bucket = bySample.get(kind);
        if (!bucket) return [];
        const all = [...bucket.newLabs, ...bucket.repeatLabs];
        if (all.length === 0) return [];
        return [
          <div key={kind}>
            <SectionHeader>
              {SAMPLE_TYPE_ICON[kind]} {kind} ({all.length})
            </SectionHeader>
            <div style={{ display: "grid", gap: 8, paddingLeft: 4 }}>
              {bucket.newLabs.length > 0 && (
                <div>
                  <SubHeader tone="primary">🆕 Order now ({bucket.newLabs.length})</SubHeader>
                  <div style={{ display: "grid", gap: 4 }}>
                    {bucket.newLabs.map((l, i) => (
                      <Row key={`${kind}-new-${l.label}-${i}`} label={l.label} detail={l.detail} />
                    ))}
                  </div>
                </div>
              )}
              {bucket.repeatLabs.length > 0 && (
                <div>
                  <SubHeader>🔁 At recheck ({bucket.repeatLabs.length})</SubHeader>
                  <div style={{ display: "grid", gap: 4 }}>
                    {bucket.repeatLabs.map((l, i) => {
                      const ll = l as LabRow & { status?: DueStatus };
                      return (
                        <Row
                          key={`${kind}-rep-${l.label}-${i}`}
                          label={l.label}
                          detail={l.detail}
                          dueDate={l.dueDate}
                          status={ll.status}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>,
        ];
      })}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────

function SectionHeader({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "primary";
}) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 700,
        color: tone === "primary" ? "var(--fm-primary)" : "var(--fm-text-secondary)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function SubHeader({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "primary";
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: tone === "primary" ? "var(--fm-primary)" : "var(--fm-text-tertiary)",
        marginBottom: 4,
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  detail,
  dueDate,
  status,
}: {
  label: string;
  detail?: string;
  dueDate?: string | null;
  status?: DueStatus;
}) {
  const chip = (() => {
    if (!status) return null;
    if (status === "overdue") {
      return { bg: "#fee2e2", color: "#991b1b", text: `⚠ Overdue${dueDate ? ` (${fmtDate(dueDate)})` : ""}` };
    }
    if (status === "due_today") {
      return { bg: "#fed7aa", color: "#9a3412", text: "📍 Due today" };
    }
    if (status === "due_soon") {
      return { bg: "#fef3c7", color: "#92400e", text: `⏰ Due ${dueDate ? fmtDate(dueDate) : "soon"}` };
    }
    if (status === "future" && dueDate) {
      return { bg: "#e0e7ff", color: "#3730a3", text: `🗓 ${fmtDate(dueDate)}` };
    }
    return null;
  })();

  return (
    <div
      style={{
        fontSize: 12,
        padding: "5px 8px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--fm-text-primary)" }}>{label}</span>
        {chip && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 999,
              background: chip.bg,
              color: chip.color,
            }}
          >
            {chip.text}
          </span>
        )}
      </div>
      {detail && (
        <div style={{ fontSize: 11, color: "var(--fm-text-secondary)", marginTop: 1 }}>
          {detail}
        </div>
      )}
    </div>
  );
}
