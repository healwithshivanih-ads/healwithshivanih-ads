"use client";

/**
 * BeightonVerifyPanel (v0.75.3) — coach-led bilateral Beighton score
 * confirmation. Client self-reports /5 (single-side, anyone) on intake;
 * coach confirms bilaterally for a true /9 score (the standard clinical
 * Beighton).
 *
 * 9 points = 4 paired bilateral (left + right pinky, thumb, elbow, knee)
 * + 1 single (palms to floor). Saves to client.physical_exam_findings[]
 * with kind="beighton".
 *
 * Threshold interpretation:
 *   adults < 50:     ≥ 5/9 = hypermobility
 *   adults ≥ 50:     ≥ 4/9 = hypermobility
 *   adolescents:     ≥ 6/9 = hypermobility
 *   (Surfaced as guidance text; coach decides clinical significance.)
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveExamFindingAction } from "@/lib/server-actions/clients";

interface Props {
  clientId: string;
  /** Self-reported chips from intake — what the client ticked. */
  selfReportTicks?: string[];
  /** Latest saved beighton finding, if any — read-only summary. */
  latestSavedAt?: string;
  latestScore?: number;
  /** Estimated client age — drives threshold guidance. */
  ageYears?: number | null;
}

interface ChecklistItem {
  key: string;
  label: string;
  /** If true, this point is bilateral (R + L count separately). */
  bilateral: boolean;
}

const ITEMS: ChecklistItem[] = [
  { key: "pinky", label: "Pinky finger bends back past 90°", bilateral: true },
  { key: "thumb", label: "Thumb touches inside of forearm", bilateral: true },
  { key: "elbow", label: "Elbow hyperextends past straight by > 10°", bilateral: true },
  { key: "knee", label: "Knee hyperextends past straight by > 10°", bilateral: true },
  { key: "palms_floor", label: "Palms flat on floor with knees locked straight", bilateral: false },
];

export function BeightonVerifyPanel({
  clientId,
  selfReportTicks,
  latestSavedAt,
  latestScore,
  ageYears,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // State per side. For bilateral items, each side is a separate point.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");

  const score = useMemo(() => {
    let s = 0;
    for (const item of ITEMS) {
      if (item.bilateral) {
        if (ticks[`${item.key}_R`]) s++;
        if (ticks[`${item.key}_L`]) s++;
      } else {
        if (ticks[item.key]) s++;
      }
    }
    return s;
  }, [ticks]);

  const threshold = useMemo(() => {
    if (ageYears == null) return 5; // default adult <50
    if (ageYears < 18) return 6;
    if (ageYears >= 50) return 4;
    return 5;
  }, [ageYears]);

  const hypermobile = score >= threshold;

  const toggle = (key: string) =>
    setTicks((prev) => ({ ...prev, [key]: !prev[key] }));

  const onSave = () => {
    startTransition(async () => {
      const res = await saveExamFindingAction({
        client_id: clientId,
        finding: {
          kind: "beighton",
          result: {
            score,
            threshold,
            hypermobile,
            ticks,
            ages_at_assessment: ageYears,
          },
          notes: notes.trim(),
        },
      });
      if (res.ok) {
        toast.success(
          `🦋 Beighton ${score}/9 saved · ${hypermobile ? "above threshold" : "below threshold"}`,
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Save failed");
      }
    });
  };

  const selfScoreOutOf5 = (selfReportTicks ?? []).length;

  // Collapsed
  if (!open) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border-light)",
          borderRadius: "var(--fm-radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 16 }}>🦋</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Beighton verify</div>
          {latestSavedAt && latestScore != null ? (
            <div style={{ fontSize: 11, color: "var(--fm-text-secondary)" }}>
              Last: {new Date(latestSavedAt).toLocaleDateString()} · {latestScore}/9
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              {selfScoreOutOf5 > 0
                ? `Client self-reported ${selfScoreOutOf5}/5 — verify bilateral`
                : "Client did not self-report — fresh assessment"}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "5px 12px",
            fontSize: 11.5,
            fontWeight: 700,
            background: "transparent",
            color: "var(--fm-primary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
          }}
        >
          {latestSavedAt ? "Re-verify" : "Verify"}
        </button>
      </div>
    );
  }

  // Expanded
  return (
    <div
      style={{
        padding: 14,
        background: "var(--fm-surface)",
        border: "1.5px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🦋</span>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Beighton verify (bilateral)</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            marginLeft: "auto",
            padding: "3px 9px",
            fontSize: 11,
            background: "transparent",
            color: "var(--fm-text-secondary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
          }}
        >
          ✕ Close
        </button>
      </div>

      {selfScoreOutOf5 > 0 ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-secondary)",
            padding: "6px 10px",
            background: "rgba(99, 102, 241, 0.08)",
            border: "1px solid rgba(99, 102, 241, 0.25)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          💡 Client self-reported {selfScoreOutOf5}/5 on intake (single-side). Verify each item
          bilaterally for the standard /9 score.
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {ITEMS.map((item) =>
          item.bilateral ? (
            <div
              key={item.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12 }}>{item.label}</div>
              <CheckboxRow label="R" active={!!ticks[`${item.key}_R`]} onToggle={() => toggle(`${item.key}_R`)} />
              <CheckboxRow label="L" active={!!ticks[`${item.key}_L`]} onToggle={() => toggle(`${item.key}_L`)} />
            </div>
          ) : (
            <div
              key={item.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 170px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12 }}>{item.label}</div>
              <CheckboxRow
                label="Yes"
                active={!!ticks[item.key]}
                onToggle={() => toggle(item.key)}
              />
            </div>
          ),
        )}
      </div>

      <div
        style={{
          padding: "8px 12px",
          background: hypermobile && score > 0 ? "rgba(220, 38, 38, 0.08)" : "var(--fm-bg-cool)",
          border: `1px solid ${hypermobile && score > 0 ? "#dc2626" : "var(--fm-border-light)"}`,
          borderRadius: "var(--fm-radius-sm)",
          fontSize: 12,
        }}
      >
        <strong>
          Score: {score}/9
        </strong>
        {" · threshold ≥ "}
        {threshold}
        {ageYears != null ? ` (age ${ageYears})` : ""}
        {hypermobile && score > 0 && (
          <span style={{ color: "#9a1b1b", fontWeight: 700, marginLeft: 8 }}>
            · ⚠ Hypermobile
          </span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)", marginBottom: 6 }}>
          Notes (optional)
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Pinky R obvious, L harder; client says she could palm-floor easily as a teen."
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "inherit",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            resize: "vertical",
          }}
        />
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        style={{
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: pending ? "#94a3b8" : "var(--fm-primary)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--fm-radius-sm)",
          cursor: pending ? "wait" : "pointer",
          width: "fit-content",
        }}
      >
        {pending ? "Saving…" : "💾 Save Beighton verify"}
      </button>
    </div>
  );
}

function CheckboxRow({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        fontSize: 11.5,
        fontWeight: 600,
        background: active ? "var(--fm-primary)" : "transparent",
        color: active ? "#fff" : "var(--fm-text-secondary)",
        border: `1px solid ${active ? "var(--fm-primary)" : "var(--fm-border)"}`,
        borderRadius: "var(--fm-radius-sm)",
        cursor: "pointer",
        fontFamily: "inherit",
        width: "100%",
        justifyContent: "center",
      }}
    >
      <span>{active ? "✓" : "○"}</span>
      <span>{label}</span>
    </button>
  );
}
