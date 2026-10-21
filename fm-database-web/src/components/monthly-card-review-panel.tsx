"use client";

/**
 * 🗓 Monthly cards to check — the only part of the monthly do's & don'ts the
 * coach ever sees. The cron writes every maintenance client's card on its own;
 * this lists the few it held because something stood out, with the reason.
 * Tap a line to leave it out, then Approve (it goes live on their app) or
 * Skip this month. Self-hides when nothing is held.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FmPanel } from "@/components/fm";
import { approveMonthlyCardAction, skipMonthlyCardAction } from "@/lib/server-actions/monthly-cards";
import type { HeldMonthlyCard } from "@/lib/fmdb/monthly-cards-store";

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

const box: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--fm-surface)",
  border: "1px solid var(--fm-border-light)",
  borderRadius: "var(--fm-radius-sm)",
};

function Row({ h }: { h: HeldMonthlyCard }) {
  const router = useRouter();
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const toggle = (line: string) =>
    setDrop((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr("");
      const r = await fn();
      if (!r.ok) setErr(r.error || "failed");
      else router.refresh();
    });

  const line = (s: string, i: number) => (
    <li
      key={i}
      onClick={() => toggle(s)}
      title={drop.has(s) ? "Left out. Tap to keep" : "Tap to leave this line out"}
      style={{ cursor: "pointer", textDecoration: drop.has(s) ? "line-through" : "none", opacity: drop.has(s) ? 0.45 : 1 }}
    >
      {s}
    </li>
  );

  return (
    <div style={box}>
      <div style={{ fontSize: 13 }}>
        <Link href={`/clients-v2/${h.clientId}`} style={{ fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}>
          {h.clientName}
        </Link>
        <span style={{ color: "var(--fm-text-secondary)" }}> · {monthLabel(h.month)}</span>
      </div>
      <ul style={{ margin: "6px 0 8px", paddingLeft: 18, fontSize: 12.5, color: "#a8472f" }}>
        {(h.card.flags ?? []).map((f, i) => (
          <li key={i}>⚠ {f}</li>
        ))}
      </ul>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#2d5a3d", textTransform: "uppercase" }}>Do</div>
          <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>{(h.card.dos ?? []).map(line)}</ul>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a8472f", textTransform: "uppercase" }}>Don&apos;t</div>
          <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>{(h.card.donts ?? []).map(line)}</ul>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveMonthlyCardAction(h.clientId, h.planSlug, h.month, [...drop]))}
          style={{ background: "#2d5a3d", color: "#fff", border: 0, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
        >
          ✓ Approve{drop.size ? ` without ${drop.size} line${drop.size === 1 ? "" : "s"}` : ""}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => skipMonthlyCardAction(h.clientId, h.planSlug, h.month))}
          style={{ background: "transparent", color: "var(--fm-text-secondary)", border: "1px solid var(--fm-border-light)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}
        >
          Skip this month
        </button>
        {err && <span style={{ fontSize: 12, color: "#a8472f" }}>{err}</span>}
      </div>
    </div>
  );
}

export function MonthlyCardReviewPanel({ held }: { held: HeldMonthlyCard[] }) {
  if (held.length === 0) return null;
  return (
    <FmPanel
      title="🗓 Monthly cards to check"
      subtitle={`${held.length} card${held.length === 1 ? "" : "s"} held back because something stood out. Every other maintenance card went out on its own.`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {held.map((h) => (
          <Row key={`${h.clientId}-${h.month}`} h={h} />
        ))}
      </div>
    </FmPanel>
  );
}
