"use client";

/**
 * FmFloatingActions — speed-dial FAB pinned bottom-right of FmAppShell.
 *
 * The "quick actions" surface from the v2 design file. Tap the primary
 * orange pill to expand a vertical stack of context-aware actions:
 * new quick note, new session, send template message, etc.
 *
 * Wired into FmAppShell so every v2 route gets it by default. Pages that
 * want context-aware actions pass an `actions` override to FmAppShell;
 * otherwise the global default set is used.
 *
 * Design notes:
 *   - Primary pill: --fm-primary background, white +, rotates 45° to ×
 *     when open (Material FAB pattern).
 *   - Action chips: white pill with icon + label, slide-in from below
 *     on open. Each chip is a Link or a button (onClick).
 *   - Backdrop: dim layer behind the chips that closes the panel on
 *     click. Esc closes too.
 *   - Sits at z-index 110, above FmAppShell (100), below modal layers.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface FmFloatingActionItem {
  /** Stable id used for keys. */
  id: string;
  /** Emoji or short character — rendered as the icon glyph. */
  icon: string;
  /** Short label shown on the chip. Keep under ~22 chars. */
  label: string;
  /** Either a route (next/link) or a click handler. */
  href?: string;
  onClick?: () => void;
  /** Optional one-line hint, shown under the label. */
  hint?: string;
}

export interface FmFloatingActionsProps {
  /** The actions to surface. If empty, the FAB doesn't render. */
  actions: FmFloatingActionItem[];
  /** Override the trigger label (default "Quick action"). */
  triggerLabel?: string;
  /** Override the trigger icon (default "+"). */
  triggerIcon?: string;
}

export function FmFloatingActions({
  actions,
  triggerLabel = "Quick action",
  triggerIcon = "+",
}: FmFloatingActionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape, click outside.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      {/* Dim backdrop while open (subtle — doesn't fully cover, just hints) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(43, 45, 66, 0.18)",
            zIndex: 109,
            transition: "opacity 0.18s ease",
          }}
        />
      )}

      <div
        ref={rootRef}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 110,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 10,
        }}
      >
        {/* Action chips — newest on top. Render only when open so they
            can mount/unmount with transitions. */}
        {open && (
          <div
            style={{
              display: "flex",
              flexDirection: "column-reverse",
              gap: 8,
              animation: "fmFabIn 0.16s ease",
            }}
          >
            {actions.map((a, i) => (
              <ActionChip
                key={a.id}
                item={a}
                onSelect={() => setOpen(false)}
                index={i}
              />
            ))}
          </div>
        )}

        {/* Trigger pill */}
        <button
          type="button"
          aria-label={triggerLabel}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: open ? "#2B2D42" : "var(--fm-primary)",
            color: "#fff",
            border: 0,
            padding: open ? "13px 16px" : "13px 18px 13px 20px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
            boxShadow:
              "0 6px 18px rgba(255, 107, 53, 0.35), 0 2px 6px rgba(0,0,0,0.08)",
            transition:
              "background 0.16s ease, padding 0.16s ease, transform 0.16s ease",
          }}
        >
          <span
            style={{
              fontSize: 18,
              lineHeight: 1,
              display: "inline-block",
              transform: open ? "rotate(45deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease",
              width: 16,
              textAlign: "center",
            }}
          >
            {triggerIcon}
          </span>
          <span>{open ? "Close" : triggerLabel}</span>
        </button>
      </div>

    </>
  );
}

function ActionChip({
  item,
  onSelect,
}: {
  item: FmFloatingActionItem;
  onSelect: () => void;
  index: number;
}) {
  const inner = (
    <>
      <span
        style={{
          width: 28,
          height: 28,
          background: "var(--fm-bg-warm)",
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {item.icon}
      </span>
      <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fm-text-primary)",
            lineHeight: 1.2,
          }}
        >
          {item.label}
        </span>
        {item.hint && (
          <span
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              marginTop: 1,
              lineHeight: 1.3,
            }}
          >
            {item.hint}
          </span>
        )}
      </div>
    </>
  );

  const sharedStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 14px 7px 8px",
    background: "var(--fm-surface)",
    border: "1px solid var(--fm-border)",
    borderRadius: 999,
    boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
    cursor: "pointer",
    textDecoration: "none",
    fontFamily: "inherit",
    color: "var(--fm-text-primary)",
    fontSize: 13,
    transition: "transform 0.12s ease, border-color 0.12s ease",
  };

  if (item.href) {
    return (
      <Link href={item.href} onClick={onSelect} style={sharedStyle}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        item.onClick?.();
        onSelect();
      }}
      style={{ ...sharedStyle, border: "1px solid var(--fm-border)" }}
    >
      {inner}
    </button>
  );
}
