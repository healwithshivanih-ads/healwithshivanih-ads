"use client";

/**
 * Client components for /clients-v2:
 *   - ClientFilters: search input + stage chips (controlled via URL).
 *   - ClientCard: one card per client. Photo (or initials), name, ID,
 *     bio line, active plan slug + status badge, last session date,
 *     stage tag with workflow-coloured tone.
 *
 * Stage-tone palette mirrors FmWorkflowBanner so a coach who knows
 * the colours from the Plan tab reads the list at a glance.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import type { ClientRow } from "./page";
import { UnreadBadge } from "@/components/fm/UnreadBadge";

const STAGE_META: Record<
  ClientRow["stage"],
  { label: string; bg: string; fg: string; border: string }
> = {
  active: {
    label: "Plan active",
    bg: "rgba(46, 204, 113, 0.10)",
    fg: "#1E8449",
    border: "rgba(46, 204, 113, 0.40)",
  },
  draft: {
    label: "Draft plan",
    bg: "rgba(110, 76, 200, 0.10)",
    fg: "#5a3fb0",
    border: "rgba(110, 76, 200, 0.40)",
  },
  no_plan: {
    label: "No plan yet",
    bg: "rgba(255, 107, 53, 0.10)",
    fg: "var(--fm-primary)",
    border: "rgba(255, 107, 53, 0.35)",
  },
  recheck: {
    label: "Recheck due",
    bg: "rgba(184, 119, 10, 0.10)",
    fg: "#B8770A",
    border: "rgba(184, 119, 10, 0.45)",
  },
};

function relAge(dateStr: string | undefined, todayStr: string): string {
  if (!dateStr) return "";
  try {
    const days = Math.round(
      (new Date(todayStr).getTime() - new Date(dateStr).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (days < 0) return "soon";
    if (days === 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.round(days / 30)}mo ago`;
    return `${Math.round(days / 365)}y ago`;
  } catch {
    return "";
  }
}

const SESSION_EMOJI: Record<string, string> = {
  discovery: "🔍",
  intake: "📋",
  check_in: "💬",
  quick_note: "📝",
};

// ─────────────────────────────────────────────────────────────────
// Filter chip bar — controlled via ?q + ?filter URL params
// ─────────────────────────────────────────────────────────────────
export function ClientFilters({
  active,
  counts,
  q,
}: {
  active: "all" | "active" | "draft" | "no_plan" | "recheck";
  counts: Record<string, number>;
  q: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [qLocal, setQLocal] = useState(q);

  // Debounce search input → URL
  useEffect(() => {
    if (qLocal === q) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (qLocal) next.set("q", qLocal);
      else next.delete("q");
      router.replace(`/clients-v2?${next.toString()}`);
    }, 220);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  function setFilter(id: typeof active) {
    const next = new URLSearchParams(params);
    if (id === "all") next.delete("filter");
    else next.set("filter", id);
    router.replace(`/clients-v2?${next.toString()}`);
  }

  const chips: { id: typeof active; label: string }[] = [
    { id: "all", label: "All" },
    { id: "recheck", label: "🔁 Recheck due" },
    { id: "active", label: "✅ Active plan" },
    { id: "draft", label: "📋 Draft" },
    { id: "no_plan", label: "🔍 No plan yet" },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 14,
        marginBottom: 4,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 220,
          maxWidth: 360,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px",
          background: "var(--fm-surface)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
        }}
      >
        <span style={{ color: "var(--fm-text-tertiary)", fontSize: 12 }}>
          🔍
        </span>
        <input
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder="Search by name or client id…"
          style={{
            flex: 1,
            border: 0,
            outline: "none",
            background: "transparent",
            fontSize: 12,
            fontFamily: "inherit",
          }}
        />
        {qLocal && (
          <button
            type="button"
            onClick={() => setQLocal("")}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--fm-text-tertiary)",
              cursor: "pointer",
              fontSize: 14,
            }}
            aria-label="Clear"
          >
            ×
          </button>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 5,
          flexWrap: "wrap",
        }}
      >
        {chips.map((c) => {
          const isActive = active === c.id;
          const count = counts[c.id] ?? 0;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                background: isActive ? "var(--fm-primary)" : "var(--fm-surface)",
                color: isActive ? "#fff" : "var(--fm-text-secondary)",
                border: `1px solid ${isActive ? "var(--fm-primary)" : "var(--fm-border)"}`,
                borderRadius: "var(--fm-radius-pill)",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {c.label}
              <span
                style={{
                  fontSize: 9.5,
                  opacity: isActive ? 0.85 : 0.55,
                  fontWeight: 700,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// One card per client
// ─────────────────────────────────────────────────────────────────
export function ClientCard({
  row,
  todayStr,
  unread,
}: {
  row: ClientRow;
  todayStr: string;
  unread?: import("@/lib/fmdb/loader-extras").ClientUnreadCounts;
}) {
  const tone = STAGE_META[row.stage];
  const initials = row.display_name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Link
      href={`/clients-v2/${row.client_id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-md)",
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 140ms, transform 140ms",
        position: "relative",
      }}
    >
      {/* Top row: avatar + name + stage */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <AvatarBlock
          clientId={row.client_id}
          initials={initials}
          hasPhoto={row.has_photo}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--fm-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.display_name}
            <UnreadBadge counts={unread} />
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--fm-text-tertiary)",
              fontFamily: "var(--fm-font-mono)",
              marginTop: 1,
            }}
          >
            {row.client_id}
            {row.intake_date && (
              <span style={{ marginLeft: 6, fontFamily: "inherit" }}>
                · intake {row.intake_date}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bio row */}
      <div
        style={{
          fontSize: 11,
          color: "var(--fm-text-secondary)",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {row.age != null && <span>🎂 {row.age}</span>}
        {row.sex && <span>{row.sex === "F" ? "♀" : row.sex === "M" ? "♂" : "·"} {row.sex}</span>}
        {row.city && <span>📍 {row.city}</span>}
      </div>

      {/* Stage tag */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
          padding: "3px 9px",
          background: tone.bg,
          color: tone.fg,
          border: `1px solid ${tone.border}`,
          borderRadius: "var(--fm-radius-pill)",
          fontSize: 10.5,
          fontWeight: 700,
        }}
      >
        {tone.label}
        {row.active_plan && (
          <span
            style={{
              fontFamily: "var(--fm-font-mono)",
              fontSize: 9.5,
              opacity: 0.75,
              fontWeight: 600,
              maxWidth: 130,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            · {row.active_plan.slug}
          </span>
        )}
      </div>

      {/* Last session + next contact */}
      <div
        style={{
          fontSize: 10.5,
          color: "var(--fm-text-tertiary)",
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginTop: -2,
        }}
      >
        <span>
          {row.last_session ? (
            <>
              {SESSION_EMOJI[row.last_session.type] ?? "·"} Last:{" "}
              {row.last_session.date} · {relAge(row.last_session.date, todayStr)}
            </>
          ) : (
            "No sessions yet"
          )}
        </span>
        {row.next_contact_date && (
          <span style={{ color: "var(--fm-text-secondary)" }}>
            📅 next {row.next_contact_date}
          </span>
        )}
      </div>
    </Link>
  );
}

function AvatarBlock({
  clientId,
  initials,
  hasPhoto,
}: {
  clientId: string;
  initials: string;
  hasPhoto: boolean;
}) {
  const [photoOk, setPhotoOk] = useState(hasPhoto);
  if (photoOk) {
    return (
      <img
        src={`/api/client-photo/${clientId}`}
        alt=""
        onError={() => setPhotoOk(false)}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          objectFit: "cover",
          background: "var(--fm-bg-warm)",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--fm-bg-warm)",
        color: "var(--fm-primary)",
        fontWeight: 700,
        fontSize: 14,
        flexShrink: 0,
      }}
    >
      {initials || "·"}
    </span>
  );
}
