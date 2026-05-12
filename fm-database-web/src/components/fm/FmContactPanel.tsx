"use client";

/**
 * FmContactPanel — pinned fields + "More details" disclosure (design 4A).
 *
 * 6 pinned fields cover 90% of pre-session glances. Disclosure preserves
 * panel height when closed so the sidebar doesn't jump when toggled.
 *
 * MTHFR / APOE / COMT in the More section come from the genome report
 * parser writing summary keys to client.yaml (confirmation B). If those
 * keys aren't present, the rows render "—" (no genome report on file).
 */
import { useState } from "react";
import { FmPanel, FmInfoRow } from "./FmPanel";

export interface FmContactRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Renders the value in primary orange + bold (used for next_contact_date). */
  strong?: boolean;
}

export interface FmContactPanelProps {
  /** 6 fields shown by default — phone, email, location, next contact, diet, avoids. */
  pinned: FmContactRow[];
  /** Disclosure fields — tz/lang, address, family hx, MTHFR summary, cycle, etc. */
  more?: FmContactRow[];
  onEdit?: () => void;
}

export function FmContactPanel({ pinned, more, onEdit }: FmContactPanelProps) {
  const [open, setOpen] = useState(false);
  const moreCount = more?.length ?? 0;

  return (
    <FmPanel
      title="Quick contact"
      rightSlot={
        onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            title="Edit fields"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--fm-text-tertiary)",
              cursor: "pointer",
              fontSize: 14,
              padding: 4,
            }}
          >
            ✎
          </button>
        ) : undefined
      }
    >
      <div style={{ display: "grid", gap: 0 }}>
        {pinned.map((r, i) => (
          <FmInfoRow
            key={i}
            label={r.label}
            value={
              r.strong ? (
                <span style={{ color: "var(--fm-primary)", fontWeight: 700 }}>{r.value}</span>
              ) : (
                r.value
              )
            }
          />
        ))}
      </div>

      {moreCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              width: "100%",
              marginTop: 12,
              padding: "7px 10px",
              background: open ? "var(--fm-bg-cool)" : "transparent",
              border: "1px dashed var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              color: "var(--fm-text-secondary)",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: 0.3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontFamily: "inherit",
            }}
          >
            {open ? "Show less" : `More details (${moreCount} fields)`}
            <span style={{ fontSize: 10 }}>{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <div style={{ display: "grid", gap: 0, marginTop: 10 }}>
              {(more ?? []).map((r, i) => (
                <FmInfoRow
                  key={i}
                  label={r.label}
                  value={
                    r.strong ? (
                      <span style={{ color: "var(--fm-primary)", fontWeight: 700 }}>{r.value}</span>
                    ) : (
                      r.value
                    )
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </FmPanel>
  );
}
