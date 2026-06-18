"use client";

/**
 * FmCatalogueOrphanChip — standing guardrail for catalogue↔assessment wiring.
 *
 * Surfaces entities that EXIST and validate but the assessment subgraph can
 * never reach (no topic.key_mechanisms / symptom.linked_to_mechanisms /
 * mechanism.related_mechanisms points at them, or a supplement with no
 * resolving links). The AI can never surface these — the exact failure that
 * hid beta-glucuronidase-deconjugation.
 *
 * Self-loading (like StartDateReminderPanel): fetches its own status on mount
 * so it adds zero latency to the dashboard's server render, and renders
 * nothing until it has data. Hides entirely when there are no blocking
 * orphans. Informational — no mutate action; it points the coach at the fix.
 */
import { useEffect, useState, useTransition } from "react";
import {
  getCatalogueOrphanStatus,
  type OrphanStatus,
} from "@/app/catalogue-orphan-action";

const KIND_LABEL: Record<string, string> = {
  mechanism: "root cause",
  supplement: "supplement",
};

export function FmCatalogueOrphanChip() {
  const [status, setStatus] = useState<OrphanStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getCatalogueOrphanStatus());
    });

  useEffect(() => {
    void (async () => setStatus(await getCatalogueOrphanStatus()))();
  }, []);

  // Render nothing until loaded, and hide when everything's reachable.
  if (!status || status.blocking === 0) return null;

  const blockingKinds = status.byKind.filter((r) => r.blocking);
  // Group blocking items by kind for the disclosure.
  const byKind = new Map<string, typeof status.blockingItems>();
  for (const o of status.blockingItems) {
    const arr = byKind.get(o.kind) ?? [];
    arr.push(o);
    byKind.set(o.kind, arr);
  }

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(79,70,229,0.13))",
        border: "1.5px solid rgba(99,102,241,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🔗</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            {status.blocking} catalogue entr{status.blocking === 1 ? "y" : "ies"} unreachable by the assessment
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {blockingKinds
              .map((r) => `${r.n} ${KIND_LABEL[r.kind] ?? r.kind}${r.n === 1 ? "" : "s"}`)
              .join(" · ")}
            {" — the AI can never surface these until they’re linked in"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#3730a3",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "Hide list" : "Review"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          title="Re-scan"
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 10px",
            fontSize: 12,
            color: "#4f46e5",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          ↻
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              marginBottom: 10,
            }}
          >
            Fix: add each to the key_mechanisms / related_mechanisms / linked_to_* of an in-scope entity
          </div>
          {[...byKind.entries()].map(([kind, items]) => (
            <div key={kind} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--fm-text-secondary)",
                  marginBottom: 6,
                }}
              >
                {KIND_LABEL[kind] ?? kind}s ({items.length})
              </div>
              <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                {items.map((o) => (
                  <div
                    key={o.slug}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "5px 8px",
                      background: "var(--fm-bg-cool)",
                      border: "1px solid var(--fm-border-light)",
                      borderRadius: "var(--fm-radius-sm)",
                      fontSize: 12,
                    }}
                    title={o.reason}
                  >
                    <span
                      style={{
                        fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                        fontWeight: 600,
                        color: "#4338ca",
                      }}
                    >
                      {o.slug}
                    </span>
                    <span style={{ color: "var(--fm-text-tertiary)", minWidth: 0 }}>
                      {o.display_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
