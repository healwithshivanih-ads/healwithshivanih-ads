"use client";

/**
 * WeeklyGenerationPausePanel — per-client on/off for the weekly AI recipe pack.
 *
 * The coach kept hitting a case the dormancy pause does not cover: a client
 * who opens the app constantly, reads her weekly menu, and never once taps a
 * recipe. Dormancy sees an engaged client and keeps paying Haiku to write
 * recipes into the void; there was no way to say "menus yes, recipes no".
 *
 * Unlike the queue panel this one does NOT self-hide when everything is
 * running — a switch you can only find while it is already flipped is a switch
 * you cannot turn back on. It collapses to a one-line summary instead, and
 * opens to the full roster.
 *
 * Paused clients are listed FIRST and always visible in the collapsed summary,
 * because "who is switched off" is the fact that goes stale silently.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { FmPanel } from "@/components/fm";
import {
  weeklyGenerationPauseRosterAction,
  setWeeklyGenerationPausedAction,
  type WeeklyGenerationPauseRow,
} from "@/lib/server-actions/recipes";

export function WeeklyGenerationPausePanel({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<WeeklyGenerationPauseRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refresh = useCallback(
    () =>
      weeklyGenerationPauseRosterAction()
        .then(setRows)
        .catch(() => setRows([])),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // No weekly-menu clients at all → there is nothing this panel could switch.
  if (!rows || rows.length === 0) return null;

  const paused = rows.filter((r) => r.paused);
  const active = rows.filter((r) => !r.paused);
  const nameOf = (id: string) => names[id] ?? id;

  const toggle = (row: WeeklyGenerationPauseRow) => {
    setBusy(row.clientId);
    setErr(null);
    startTransition(() => {
      void setWeeklyGenerationPausedAction(row.clientId, !row.paused)
        .then((res) => {
          if (!res.ok) setErr(res.error ?? "Could not save that.");
          return refresh();
        })
        .catch((e: unknown) => setErr((e as Error).message))
        .finally(() => setBusy(null));
    });
  };

  const Row = ({ row }: { row: WeeklyGenerationPauseRow }) => (
    <li
      key={row.clientId}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: "1px solid var(--fm-border)",
      }}
    >
      <span style={{ fontSize: 13, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{nameOf(row.clientId)}</span>
        {row.paused && (
          <span style={{ color: "var(--fm-text-secondary)", marginLeft: 8, fontSize: 12 }}>
            paused
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => toggle(row)}
        disabled={busy === row.clientId}
        style={{
          flexShrink: 0,
          fontSize: 12,
          padding: "4px 11px",
          borderRadius: 6,
          cursor: busy === row.clientId ? "default" : "pointer",
          border: "1px solid var(--fm-border)",
          background: row.paused ? "var(--fm-primary, #7c9070)" : "transparent",
          color: row.paused ? "#fff" : "var(--fm-text-secondary)",
          opacity: busy === row.clientId ? 0.5 : 1,
        }}
      >
        {busy === row.clientId ? "…" : row.paused ? "Resume" : "Pause"}
      </button>
    </li>
  );

  return (
    <FmPanel
      title="Weekly menu + recipes"
      subtitle={
        paused.length
          ? `Paused for ${paused.map((r) => nameOf(r.clientId)).join(", ")} · ${active.length} running`
          : `Running for all ${active.length}`
      }
      rightSlot={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 6,
            cursor: "pointer",
            border: "1px solid var(--fm-border)",
            background: "transparent",
            color: "var(--fm-text-secondary)",
          }}
        >
          {open ? "Hide" : "Change"}
        </button>
      }
      tight
    >
      {open && (
        <>
          <p style={{ fontSize: 12, color: "var(--fm-text-secondary)", margin: "0 0 8px", lineHeight: 1.5 }}>
            Pausing stops next week&apos;s menu being drafted and stops new
            recipes being written. She stays frozen on the menu she already
            has, keeps every recipe already written, and the rest of her app is
            unchanged. Nothing turns this back on but you.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[...paused, ...active].map((r) => (
              <Row key={r.clientId} row={r} />
            ))}
          </ul>
        </>
      )}
      {err && (
        <p style={{ fontSize: 12, color: "var(--fm-danger, #b3261e)", margin: "8px 0 0" }}>{err}</p>
      )}
    </FmPanel>
  );
}
