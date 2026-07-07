"use client";

/**
 * FmVitaoneCoverageChip — standing guardrail for affiliate-commission leaks.
 *
 * VitaOne pays 30% vs FM Nutrition's 10%. The buy-link resolver already prefers
 * VitaOne; a leak means a supplement PRESCRIBED in a live plan is resolving to
 * FM Nutrition (usually because the matching VitaOne product has an empty
 * `covers` list, or none exists). Surfaces exactly those items so a new VitaOne
 * product added without covers, or a fresh script pointing at the 10% store,
 * gets caught the next time the coach opens the dashboard.
 *
 * Self-loading (like FmCatalogueOrphanChip): live-computed on mount, adds zero
 * latency to the server render, hides entirely when there's nothing to fix.
 * Items VitaOne genuinely doesn't stock are allow-listed server-side, so the
 * chip stays high-signal. Informational — points at the fix (supplement_links
 * .yaml `covers`).
 */
import { useEffect, useState, useTransition } from "react";
import {
  getVitaoneCoverageStatus,
  type VitaoneCoverageStatus,
} from "@/app/vitaone-coverage-action";

export function FmVitaoneCoverageChip() {
  const [status, setStatus] = useState<VitaoneCoverageStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getVitaoneCoverageStatus());
    });

  useEffect(() => {
    void (async () => setStatus(await getVitaoneCoverageStatus()))();
  }, []);

  // Render nothing until loaded, and hide when there are no leaks.
  if (!status || status.leaks === 0) return null;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(217,119,6,0.09), rgba(180,83,9,0.14))",
        border: "1.5px solid rgba(217,119,6,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>💸</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            {status.leaks} prescribed supplement{status.leaks === 1 ? "" : "s"}{" "}
            going to FM Nutrition (10%) instead of VitaOne (30%)
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            If VitaOne stocks it, tag the product’s `covers` in
            supplement_links.yaml so VitaOne wins the link
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
            color: "#92400e",
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
            color: "#b45309",
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
            Check vitaone.in — if stocked, add a VitaOne entry / `covers`;
            if not, it’s a legitimate FM Nutrition item
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {status.leakItems.map((l) => (
              <div
                key={l.slug}
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
              >
                <span
                  style={{
                    fontFamily:
                      "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                    fontWeight: 600,
                    color: "#b45309",
                  }}
                >
                  {l.slug}
                </span>
                <span style={{ color: "var(--fm-text-tertiary)" }}>
                  {l.plans} plan{l.plans === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
