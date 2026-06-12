"use client";

/**
 * BackLink — "take me back to the screen I came from" (coach rule
 * 2026-06-12). Uses browser history when there is one (e.g. arriving
 * from a client's app-preview panel); falls back to the given href when
 * the page was opened cold (new tab, shared link).
 */

import { useRouter } from "next/navigation";

export function BackLink({ fallbackHref = "/catalogue", label = "← Back" }: { fallbackHref?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        marginBottom: 10,
        borderRadius: 999,
        border: "1px solid rgba(120,113,108,0.3)",
        background: "transparent",
        fontSize: 12.5,
        fontWeight: 600,
        color: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
