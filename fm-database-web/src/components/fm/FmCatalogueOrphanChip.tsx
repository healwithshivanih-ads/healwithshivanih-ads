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
 * orphans — and, crucially, does NOT hide when the scan could not run, since
 * hiding is what "clean catalogue" looks like. Informational — no mutate
 * action; it points the coach at the fix.
 */
import { useEffect, useState, useTransition } from "react";
import {
  getCatalogueOrphanStatus,
  type OrphanStatus,
} from "@/app/catalogue-orphan-action";
import { chipView } from "@/lib/fmdb/guardrail-chip-view";

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

  // Four outcomes, decided in one pure place so "unavailable" cannot be folded
  // back into "hide" by a narrowing that merely satisfies the type-checker.
  // See lib/fmdb/guardrail-chip-view.ts.
  const view = chipView(
    status === null
      ? null
      : status.status === "ok"
        ? { status: "ok", actionable: status.blocking }
        : { status: "unavailable" },
  );

  // Only these two render nothing. "unavailable" is deliberately NOT in this
  // list — that is the whole invariant, and it is pinned in
  // guardrail-chip-view.test.ts rather than left to review.
  if (view === "loading" || view === "hide") return null;
  if (status === null) return null; // unreachable given the above; narrows the type

  // The scan could not run (no venv / timeout / broken JSON contract). Say so
  // quietly rather than hiding: hiding is what "everything is reachable" looks
  // like, and a guardrail that cannot tell those apart is one you stop trusting
  // for the wrong reason. Muted on purpose — this is an infrastructure note for
  // the coach's dashboard, not a catalogue finding.
  if (status.status === "unavailable") {
    return (
      <section
        style={{
          padding: "8px 12px",
          borderRadius: "var(--fm-radius-lg)",
          background: "var(--fm-bg-cool)",
          border: "1px dashed var(--fm-border-light)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          color: "var(--fm-text-tertiary)",
        }}
      >
        <span aria-hidden>🔗</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          Couldn’t check catalogue reachability — {status.error}
        </span>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          style={{
            background: "transparent",
            border: "1px solid var(--fm-border-light)",
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--fm-text-secondary)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  // Everything below is the alarm: the scan succeeded and found blocking orphans.
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
