"use client";

/**
 * Filter chip bar for the WhatsApp inbox. URL-driven (?filter=...) so
 * shareable links work and the filter survives router.refresh().
 */

import { useRouter, useSearchParams } from "next/navigation";

type FilterId = "unread" | "all" | "today" | "7d";

const CHIPS: { id: FilterId; label: string }[] = [
  { id: "unread", label: "🔔 Unread" },
  { id: "today", label: "📆 Today" },
  { id: "7d", label: "📅 Last 7 days" },
  { id: "all", label: "All" },
];

export function InboxFilters({
  active,
  counts,
}: {
  active: FilterId;
  counts: { unread: number; today: number; "7d": number; all: number };
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setFilter(id: FilterId) {
    const next = new URLSearchParams(params);
    if (id === "unread") next.delete("filter");
    else next.set("filter", id);
    router.replace(`/messages?${next.toString()}`);
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 12,
      }}
    >
      {CHIPS.map((c) => {
        const isActive = c.id === active;
        const count = counts[c.id];
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            style={{
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              padding: "5px 12px",
              background: isActive ? "var(--fm-primary)" : "var(--fm-surface)",
              color: isActive ? "#fff" : "var(--fm-text-secondary)",
              border: `1px solid ${
                isActive ? "var(--fm-primary)" : "var(--fm-border)"
              }`,
              borderRadius: "var(--fm-radius-pill)",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{c.label}</span>
            <span
              style={{
                fontSize: 11,
                padding: "1px 6px",
                borderRadius: "var(--fm-radius-pill)",
                background: isActive ? "rgba(255,255,255,0.22)" : "var(--fm-bg-cool)",
                color: isActive ? "#fff" : "var(--fm-text-tertiary)",
                fontWeight: 700,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
