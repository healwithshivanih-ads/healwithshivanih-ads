"use client";

/**
 * RenewalQueuePanel — who is coming to the end of their plan, and the three
 * buttons that say what was decided.
 *
 * The queue itself has existed since 3 Aug 2026 and the digest has been
 * telling the coach to "mark anyone who has decided not to continue" ever
 * since. There was no way to do that: the only two decisions on file were
 * written into the YAML by hand. So a plan ending stayed in the mail for its
 * full 30 days regardless of what had actually been agreed — the exact
 * behaviour that trains you to skim the section, which is how the one person
 * who WOULD have renewed gets missed.
 *
 * Does NOT self-hide the way the archive panel does. An empty renewals list is
 * a real, reassuring answer ("nobody is ending soon") and the end of a plan is
 * too commercially significant for its absence and its silence to look alike.
 *
 * Recording a decision writes to _renewal_decisions.yaml and nothing else. No
 * client is contacted; the renewal letter stays a separate, approved step.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  recordRenewalDecisionAction,
  undoRenewalDecisionAction,
} from "@/lib/server-actions/renewals";
import type { RenewalRow, RenewalDecision } from "@/lib/fmdb/renewal-queue";
import { FmPanel } from "@/components/fm";

const CHOICES: { key: RenewalDecision; label: string; hint: string }[] = [
  { key: "renewed", label: "✅ Renewed", hint: "They're continuing — next phase to build" },
  { key: "not_renewing", label: "🚫 Not renewing", hint: "They've decided to stop" },
  { key: "deferred", label: "⏸ Deferred", hint: "Undecided — ask again later" },
];

function whenLabel(daysLeft: number): { text: string; urgent: boolean } {
  if (daysLeft < 0) return { text: `ended ${Math.abs(daysLeft)}d ago`, urgent: true };
  if (daysLeft === 0) return { text: "ends today", urgent: true };
  if (daysLeft <= 7) return { text: `ends in ${daysLeft}d`, urgent: true };
  return { text: `ends in ${daysLeft}d`, urgent: false };
}

export function RenewalQueuePanel({ rows }: { rows: RenewalRow[] }) {
  const [pending, startTransition] = useTransition();
  // Decided rows stay on screen for this visit, showing what was recorded plus
  // an Undo. They're gone on the next page load.
  const [decided, setDecided] = useState<Record<string, RenewalDecision>>({});
  // Snapshot the rows ONCE, and render from the snapshot rather than from the
  // live prop. Recording a decision removes the row from the server's queue —
  // by design — so a router.refresh() here would make the row disappear the
  // instant it was clicked, taking the Undo with it. That leaves a mis-click
  // silently hidden for the rest of the 30-day window, which is the exact
  // failure this panel and clearDecision were written to prevent. Verified in
  // the browser on 6 Aug 2026: the row did vanish, and Undo was unreachable.
  const [visible] = useState(rows);

  function decide(r: RenewalRow, decision: RenewalDecision) {
    startTransition(async () => {
      const res = await recordRenewalDecisionAction(
        r.planSlug,
        decision,
        `coach decision from dashboard · ${r.clientName}`,
      );
      if (res.ok) {
        setDecided((p) => ({ ...p, [r.planSlug]: decision }));
        toast.success(`${r.clientName} — marked ${decision.replace("_", " ")}`);
        // No router.refresh() — see `visible` above. The write is already
        // durable and revalidatePath has cleared the server cache for the
        // next real load.
      } else {
        toast.error(res.error || "Could not record that");
      }
    });
  }

  function undo(r: RenewalRow) {
    startTransition(async () => {
      const res = await undoRenewalDecisionAction(r.planSlug);
      if (res.ok) {
        setDecided((p) => {
          const next = { ...p };
          delete next[r.planSlug];
          return next;
        });
        toast.success(`${r.clientName} back in the queue`);
      } else {
        toast.error(res.error || "Could not undo that");
      }
    });
  }

  // The heading counts what still needs deciding, not what is on screen —
  // decided rows linger only so their Undo stays reachable.
  const openCount = visible.filter((r) => !decided[r.planSlug]).length;
  const anyUrgent = visible.some((r) => r.daysLeft <= 7 && !decided[r.planSlug]);

  return (
    <FmPanel
      style={{
        background: anyUrgent ? "rgba(179, 64, 42, 0.05)" : "rgba(107, 142, 107, 0.05)",
        borderColor: anyUrgent ? "rgba(179, 64, 42, 0.3)" : "rgba(107, 142, 107, 0.3)",
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: visible.length ? 10 : 0 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            fontWeight: 700,
            color: anyUrgent ? "#b3402a" : "#4a6b4a",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>📩</span>
          <span>Plans ending ({openCount})</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 3 }}>
          {visible.length === 0
            ? "Nobody is inside their final fortnight. Nothing to decide."
            : "Say what was decided and they stop appearing here and in the morning email. Nothing is sent to the client either way."}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((r) => {
          const mark = decided[r.planSlug];
          const when = whenLabel(r.daysLeft);
          return (
            <div
              key={r.planSlug}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 10px",
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                opacity: mark ? 0.6 : 1,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Link
                  href={`/clients-v2/${r.clientId}?tab=plan`}
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                    textDecoration: "none",
                  }}
                >
                  {r.clientName}
                </Link>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: when.urgent ? "#b3402a" : "var(--fm-text-secondary)",
                  }}
                >
                  {when.text} · {r.weeks}wk
                </span>
                {r.household.length > 0 && (
                  <span style={{ fontSize: 11, color: "#b3402a", fontWeight: 600 }}>
                    · also renewing: {r.household.join(", ")}
                  </span>
                )}
              </div>

              {mark ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
                    ✓ {mark.replace("_", " ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => undo(r)}
                    disabled={pending}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--fm-text-tertiary)",
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "underline",
                      cursor: pending ? "wait" : "pointer",
                      fontFamily: "inherit",
                      padding: 0,
                    }}
                  >
                    Undo
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      title={c.hint}
                      onClick={() => decide(r, c.key)}
                      disabled={pending}
                      style={{
                        border: "1px solid var(--fm-border)",
                        background: "transparent",
                        color: "var(--fm-text-secondary)",
                        borderRadius: "var(--fm-radius-pill)",
                        padding: "4px 11px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: pending ? "wait" : "pointer",
                        fontFamily: "inherit",
                        opacity: pending ? 0.6 : 1,
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FmPanel>
  );
}
