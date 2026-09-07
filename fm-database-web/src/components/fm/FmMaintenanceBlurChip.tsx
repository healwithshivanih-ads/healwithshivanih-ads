"use client";

/**
 * FmMaintenanceBlurChip — standing guardrail so no maintenance client is left
 * on a full plan.
 *
 * Maintenance mode is set on the client, but the plan they're on is separate.
 * A graduate can end up in maintenance while still on their full active
 * protocol — same weekly menu, full supplement stack, "lighter" in name only.
 * This flags them so the coach generates a real maintenance plan (🌿 Maintenance
 * in the follow-up panel on the client's plan page).
 *
 * Self-loading like the other dashboard guardrails: fetches on mount, adds zero
 * latency to the server render, and renders nothing when clean. Report only —
 * regenerating a plan is a clinical decision, so it points, it doesn't mutate.
 */
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getMaintenanceBlurStatus,
  type MaintenanceBlurStatus,
} from "@/app/maintenance-blur-action";

export function FmMaintenanceBlurChip() {
  const [status, setStatus] = useState<MaintenanceBlurStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setStatus(await getMaintenanceBlurStatus());
    });

  useEffect(() => {
    void (async () => setStatus(await getMaintenanceBlurStatus()))();
  }, []);

  if (!status || status.flagged === 0) return null;

  const n = status.flagged;

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(217,119,6,0.08), rgba(180,83,9,0.13))",
        border: "1.5px solid rgba(217,119,6,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🌿</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
            {n} maintenance client{n === 1 ? "" : "s"} still on a full plan
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
            They&apos;re in maintenance mode but their published plan isn&apos;t a
            maintenance plan — full menu &amp; supplement stack. Generate a lighter
            one (🌿 Maintenance) so it reads as genuinely different.
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
            Fix: open the client&apos;s plan → 🌿 Maintenance → generate a lighter
            plan, review, publish
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {status.items.map((c) => (
              <Link
                key={c.client_id}
                href={`/clients-v2/${c.client_id}?tab=plan`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "6px 8px",
                  background: "var(--fm-bg-cool)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 12,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ fontWeight: 600, color: "#b45309" }}>
                  {c.display_name ?? c.client_id}
                </span>
                <span
                  style={{
                    fontFamily: "var(--fm-font-mono, ui-monospace, Menlo, monospace)",
                    color: "var(--fm-text-tertiary)",
                    fontSize: 11,
                  }}
                >
                  {c.client_id}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--fm-text-tertiary)" }}>
                  on full plan
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
