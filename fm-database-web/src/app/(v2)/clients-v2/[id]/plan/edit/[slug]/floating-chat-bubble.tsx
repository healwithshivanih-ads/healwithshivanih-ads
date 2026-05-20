"use client";

/**
 * FloatingChatBubble — sticky bottom-right launcher for the AI plan
 * assistant on the v2 plan editor.
 *
 * Coach wanted: chat-while-scrolling. Old surface was inside the
 * editor's collapsible <details> under the Protocol tab — buried two
 * clicks deep and disappeared when the coach navigated within the
 * editor. Now it floats in the corner: collapsed = small disc with
 * 💬 icon + unread-dot when there's content, expanded = ~420px
 * wide panel anchored bottom-right.
 *
 * The panel internals re-use the same PlanChatPanel that lives inside
 * the editor (same actions, same persistence, same client_patch
 * support). We just wrap it in a different chrome.
 *
 * Hidden entirely on read-only plans (published / superseded /
 * revoked) — caller decides via `isLocked` prop.
 */
import { useState, useEffect } from "react";
import { PlanChatPanel } from "@/components/plan-editor/plan-chat-panel";

interface Props {
  slug: string;
  clientId: string;
  isLocked: boolean;
}

export function FloatingChatBubble({ slug, clientId, isLocked }: Props) {
  const [open, setOpen] = useState(false);

  // Persist open/closed state per plan in sessionStorage so a tab
  // switch within the editor doesn't collapse the chat.
  const storageKey = `fm-floating-chat:${slug}:open`;
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored === "1") setOpen(true);
    } catch {
      /* sessionStorage blocked */
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [storageKey, open]);

  // Locked plans don't get a chat bubble — the server action would
  // refuse the write anyway and the v2 plan overview already shows
  // a "create a draft" hint card. No reason to clutter the editor
  // viewport with a button that can't help.
  if (isLocked) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open AI plan assistant"
        title="Ask the AI to edit this plan"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: 0,
          background: "var(--fm-primary)",
          color: "#fff",
          fontSize: 24,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 6px 24px rgba(43, 45, 66, 0.28)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 120ms ease",
          fontFamily: "inherit",
        }}
        onMouseDown={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.94)";
        }}
        onMouseUp={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        }}
      >
        💬
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: "min(440px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 48px)",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        boxShadow: "0 12px 36px rgba(43, 45, 66, 0.18)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header strip — title + collapse button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "var(--fm-bg-cool)",
          borderBottom: "1px solid var(--fm-border-light)",
        }}
      >
        <span style={{ fontSize: 16 }}>💬</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fm-text-primary)",
            flex: 1,
          }}
        >
          AI plan assistant
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          style={{
            width: 24,
            height: 24,
            border: 0,
            background: "transparent",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            color: "var(--fm-text-secondary)",
            fontFamily: "inherit",
          }}
        >
          ×
        </button>
      </div>

      {/* Hint strip — gives coach a clue what the chat does without
          requiring her to read the editor's instructional copy. */}
      <div
        style={{
          padding: "8px 12px",
          background: "var(--fm-bg-warm)",
          borderBottom: "1px solid var(--fm-border-light)",
          fontSize: 11,
          color: "var(--fm-text-secondary)",
          lineHeight: 1.5,
        }}
      >
        Try: <em>&quot;swap NAC for selenium&quot;</em>, <em>&quot;add ferritin
          recheck at week 12&quot;</em>, or tell me an enduring fact about the client
        (<em>&quot;she doesn&apos;t like onions&quot;</em>) — I&apos;ll persist it
        on her profile.
      </div>

      {/* PlanChatPanel — same component the legacy editor uses; we
          inherit its history rehydration, transitions, error toasts. */}
      <div
        style={{
          padding: 12,
          overflowY: "auto",
          flex: 1,
        }}
      >
        <PlanChatPanel
          slug={slug}
          clientId={clientId}
          isLocked={false}
        />
      </div>
    </div>
  );
}
