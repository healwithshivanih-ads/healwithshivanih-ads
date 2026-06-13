"use client";

/**
 * DeferredPlanItemsPanel — dashboard widget surfacing every plan's
 * "Revisit later" items (interventions the assess AI deliberately held back
 * behind a clinical gate, e.g. seed cycling pending a day-21 progesterone
 * result). Until now these were buried in plan.notes_for_coach prose.
 *
 * Per row the coach can:
 *   • Override — make the call to include it. Records the decision + appends a
 *     plan amendment so the NEXT menu/plan regeneration picks it up (nothing
 *     changes in the plan content until then).
 *   • Snooze until lab back — hide it until the gate marker lands on file.
 *
 * A green "ready to decide" chip appears once the gate marker is on file.
 * Self-hides when there's nothing to revisit.
 */

import { useEffect, useState } from "react";
import { FmPanel, FmChip } from "@/components/fm";
import type { DeferredRow } from "@/lib/server-actions/deferred-items";

type Resolved = { kind: "overridden" | "snoozed"; detail: string };

export function DeferredPlanItemsPanel({ initialRows }: { initialRows?: DeferredRow[] }) {
  const [rows, setRows] = useState<DeferredRow[] | null>(initialRows ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [openOverride, setOpenOverride] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { listDeferredItemsAction } = await import("@/lib/server-actions/deferred-items");
      const r = await listDeferredItemsAction();
      if (!r.ok) setError(r.error);
      else setRows(r.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Server-rendered rows are passed in; only fetch client-side when they're not.
    if (!initialRows) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doOverride(row: DeferredRow) {
    setBusy(row.key);
    setRowErr((p) => ({ ...p, [row.key]: "" }));
    try {
      const { overrideDeferredItemAction } = await import("@/lib/server-actions/deferred-items");
      const r = await overrideDeferredItemAction(row.plan_slug, row.item_key, row.title, note);
      if (!r.ok) {
        setRowErr((p) => ({ ...p, [row.key]: r.error || "Failed" }));
      } else {
        setResolved((p) => ({
          ...p,
          [row.key]: { kind: "overridden", detail: "flagged for next menu/plan regen" },
        }));
        setOpenOverride(null);
        setNote("");
      }
    } catch (e) {
      setRowErr((p) => ({ ...p, [row.key]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setBusy(null);
    }
  }

  async function doSnooze(row: DeferredRow) {
    setBusy(row.key);
    setRowErr((p) => ({ ...p, [row.key]: "" }));
    try {
      const { snoozeDeferredItemAction } = await import("@/lib/server-actions/deferred-items");
      const r = await snoozeDeferredItemAction(row.plan_slug, row.item_key, row.gate_markers);
      if (!r.ok) {
        setRowErr((p) => ({ ...p, [row.key]: r.error || "Failed" }));
      } else {
        const detail =
          r.markers && r.markers.length > 0
            ? `back when ${r.markers.join(" / ")} lands`
            : r.until
              ? `until ${r.until}`
              : "snoozed";
        setResolved((p) => ({ ...p, [row.key]: { kind: "snoozed", detail } }));
      }
    } catch (e) {
      setRowErr((p) => ({ ...p, [row.key]: e instanceof Error ? e.message : "Failed" }));
    } finally {
      setBusy(null);
    }
  }

  if (rows && rows.length === 0 && !loading && !error) return null;

  return (
    <FmPanel
      title="⏳ Plan items to revisit"
      subtitle="Interventions deliberately deferred behind a clinical gate — override to include, or snooze until the lab is back"
    >
      <div style={{ display: "grid", gap: 10 }}>
        {loading && <div style={{ fontSize: 13, opacity: 0.7 }}>Loading…</div>}
        {error && <div style={{ fontSize: 12, color: "#dc2626" }}>{error}</div>}

        {rows && rows.length > 0 && (
          <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((row) => {
              const res = resolved[row.key];
              const isOpen = openOverride === row.key;
              const isBusy = busy === row.key;
              const err = rowErr[row.key];
              const isExpanded = expanded.has(row.key);
              const longBody = row.body.length > 180;
              return (
                <li
                  key={row.key}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: row.gate_ready
                      ? "rgba(5, 150, 105, 0.06)"
                      : "rgba(217, 119, 6, 0.05)",
                    border: row.gate_ready
                      ? "1px solid rgba(5, 150, 105, 0.25)"
                      : "1px solid rgba(217, 119, 6, 0.22)",
                    display: "grid",
                    gap: 6,
                    opacity: res ? 0.7 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{row.title}</span>
                      <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>
                        ·{" "}
                        <a
                          href={`/clients-v2/${row.client_id}`}
                          style={{ color: "#0369a1", textDecoration: "none" }}
                        >
                          {row.display_name || row.client_id}
                        </a>
                      </span>
                    </div>
                    {row.gate_ready && !res && (
                      <FmChip tone="success">✅ {row.gate_markers.join(" / ")} on file — ready to decide</FmChip>
                    )}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.45 }}>
                    {longBody && !isExpanded ? `${row.body.slice(0, 180)}… ` : row.body}
                    {longBody && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((p) => {
                            const n = new Set(p);
                            if (n.has(row.key)) n.delete(row.key);
                            else n.add(row.key);
                            return n;
                          })
                        }
                        style={{
                          marginLeft: 4,
                          fontSize: 11,
                          background: "transparent",
                          border: "none",
                          color: "#0369a1",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        {isExpanded ? "less" : "more"}
                      </button>
                    )}
                  </div>

                  {res ? (
                    <FmChip tone={res.kind === "overridden" ? "success" : "neutral"}>
                      {res.kind === "overridden" ? "✓ Overridden" : "💤 Snoozed"} — {res.detail}
                    </FmChip>
                  ) : (
                    <>
                      {isOpen ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional note for the override (e.g. progesterone 9.4, ovulatory — safe to add)…"
                            rows={2}
                            style={{
                              width: "100%",
                              fontSize: 12,
                              padding: "6px 8px",
                              borderRadius: 6,
                              border: "1px solid var(--fm-border)",
                              resize: "vertical",
                            }}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => doOverride(row)}
                              disabled={isBusy}
                              style={btn("#059669")}
                            >
                              {isBusy ? "…" : "Confirm override"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenOverride(null);
                                setNote("");
                              }}
                              disabled={isBusy}
                              style={btnGhost()}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenOverride(row.key);
                              setNote("");
                            }}
                            disabled={isBusy}
                            style={btn("#059669")}
                          >
                            ✅ Override — include
                          </button>
                          <button
                            type="button"
                            onClick={() => doSnooze(row)}
                            disabled={isBusy}
                            style={btnGhost()}
                            title={
                              row.gate_markers.length
                                ? `Hide until ${row.gate_markers.join(" / ")} is on file`
                                : "Hide for 30 days"
                            }
                          >
                            {isBusy ? "…" : "💤 Snooze until lab back"}
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {row.gate_text && !res && (
                    <div style={{ fontSize: 11, opacity: 0.6, fontStyle: "italic" }}>
                      Gate: {row.gate_text}
                    </div>
                  )}
                  {err && <div style={{ fontSize: 11, color: "#dc2626" }}>{err}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FmPanel>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 5,
    background: bg,
    color: "white",
    border: "none",
    cursor: "pointer",
  };
}
function btnGhost(): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 5,
    background: "transparent",
    color: "var(--fm-text-secondary)",
    border: "1px solid var(--fm-border)",
    cursor: "pointer",
  };
}
