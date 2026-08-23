"use client";

/**
 * FmCatalogueDuplicateChip — standing guardrail against duplicate catalogue
 * entities, as a RATCHET.
 *
 * Two entities for one concept is not a cosmetic problem: when they share an
 * alias, `_resolve_index` is last-wins by load order, so a lookup silently
 * picks a winner nobody chose. One cleanup session found five such pairs
 * (CoQ10 x3, mitochondrial-health x2, type-2-diabetes x2) sitting unnoticed.
 *
 * ⚠ SHOWS ONLY WHAT IS **NEW** — never the accepted backlog. All ~349 findings
 * on disk today are recorded in `_duplicates_baseline.yaml`; rendering those
 * would put "47 critical" on every dashboard load, forever, about debt already
 * triaged. That is the wallpaper failure FmAlertGroup was built to fix. The
 * known total appears once, as context, inside the disclosure.
 *
 * Why a chip at all when the pre-push hook and catalogue-ci already ratchet:
 * batches are approved through /ingest in THIS UI, and the coach never sees a
 * pre-push hook (pushes are assistant-owned). Without this, a duplicate created
 * by an approve stays invisible until someone next pushes catalogue changes.
 *
 * Self-loading (like FmCatalogueOrphanChip): fetches its own status on mount so
 * it adds zero latency to the dashboard's server render, and renders nothing
 * until it has data. Hides entirely when nothing is new — and, crucially, does
 * NOT hide when the scan could not run, since hiding is what "nothing is new"
 * looks like. Informational — no mutate action; it points the coach at the fix.
 */
import { useEffect, useState, useTransition } from "react";
import { chipView } from "@/lib/fmdb/guardrail-chip-view";
import {
  getCatalogueDuplicateStatus,
  type DuplicateStatus,
} from "@/app/catalogue-duplicate-action";
import { kindLabel } from "@/lib/fmdb/kinds";

/** What each check means in one line, and what to do about it. */
const CHECK_META: Record<string, { label: string; fix: string }> = {
  SHARED_ALIAS: {
    label: "shared alias",
    fix: "Merge them (keep the retired slug as an alias), or remove the alias from the wrong owner.",
  },
  ALIAS_IS_SLUG: {
    label: "alias shadows a slug",
    fix: "Mechanical: `fmdb duplicates --fix-aliases` strips these safely.",
  },
  SAME_DISPLAY: {
    label: "same display name",
    fix: "Indistinguishable in the UI — rename one, or merge.",
  },
  NEAR_SLUG: {
    label: "near-identical slug",
    fix: "Weakest signal — confirm by eye before merging.",
  },
};

export function FmCatalogueDuplicateChip() {
  const [status, setStatus] = useState<DuplicateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getCatalogueDuplicateStatus());
    });

  useEffect(() => {
    void (async () => setStatus(await getCatalogueDuplicateStatus()))();
  }, []);

  // Four outcomes, decided in one pure place. NOT
  // `if (!status || status.status !== "ok" || status.newCount === 0) return null`
  // — that narrowing compiles, keeps the ratchet intact, and silently restores
  // the fail-closed hide, so an unrunnable scan reads as a clean catalogue
  // again. See lib/fmdb/guardrail-chip-view.ts.
  const view = chipView(
    status === null
      ? null
      : status.status === "ok"
        ? { status: "ok", actionable: status.newCount }
        : { status: "unavailable" },
  );

  // Only these two render nothing; "unavailable" is deliberately absent.
  if (view === "loading" || view === "hide") return null;
  if (status === null) return null; // unreachable given the above; narrows the type

  // The scan could not run (no venv / timeout / a payload that isn't the
  // {new, known} ratchet shape). Say so quietly — a hidden chip here means
  // "nothing new", which is exactly the claim we cannot make.
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
        <span aria-hidden>👯</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          Couldn’t check for new duplicates — {status.error}
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

  // Everything below is the alarm: the scan succeeded and found new candidates.
  const { newCount, newCritical, known, byCheck, newItems } = status;
  // `known` counts EVERY finding, the new ones included. The number worth
  // showing is the accepted remainder — otherwise the disclosure claims the
  // findings listed right below it are "already triaged, not shown".
  const accepted = Math.max(0, known - newCount);

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(225,29,72,0.07), rgba(190,18,60,0.13))",
        border: "1.5px solid rgba(225,29,72,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>👯</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#9f1239" }}>
            {newCount} new duplicate candidate{newCount === 1 ? "" : "s"} in the catalogue
            {newCritical > 0 ? ` · ${newCritical} critical` : ""}
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            {byCheck
              .map((r) => `${r.n} ${CHECK_META[r.check]?.label ?? r.check}`)
              .join(" · ")}
            {" — two entries for one concept resolve last-wins, so lookups pick a winner nobody chose"}
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
            color: "#9f1239",
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
            color: "#be123c",
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
            New since the accepted baseline
            {accepted > 0
              ? ` — ${accepted} finding${accepted === 1 ? "" : "s"} already triaged, not shown`
              : ""}
          </div>

          <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {newItems.map((d) => (
              <div
                key={`${d.check}:${d.entity_kind}:${d.slugs.join("+")}`}
                style={{
                  padding: "7px 9px",
                  background: "var(--fm-bg-cool)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      padding: "1px 6px",
                      borderRadius: "var(--fm-radius-sm)",
                      background:
                        d.severity === "CRITICAL"
                          ? "rgba(225,29,72,0.15)"
                          : "rgba(0,0,0,0.06)",
                      color:
                        d.severity === "CRITICAL" ? "#9f1239" : "var(--fm-text-tertiary)",
                    }}
                  >
                    {CHECK_META[d.check]?.label ?? d.check}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                    {kindLabel(d.entity_kind, d.slugs.length === 1 ? "singular" : "plural")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                      fontWeight: 600,
                      color: "#be123c",
                      minWidth: 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {d.slugs.join("  +  ")}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 3,
                    color: "var(--fm-text-secondary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {d.detail}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid var(--fm-border-light)",
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              lineHeight: 1.5,
            }}
          >
            {byCheck.map((r) => (
              <div key={r.check}>
                <strong>{CHECK_META[r.check]?.label ?? r.check}:</strong>{" "}
                {CHECK_META[r.check]?.fix ?? "Review by hand."}
              </div>
            ))}
            <div style={{ marginTop: 6 }}>
              A genuine false positive — and only then — is accepted with{" "}
              <code>fmdb duplicates --write-baseline</code>. Never use it to silence a real one.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
