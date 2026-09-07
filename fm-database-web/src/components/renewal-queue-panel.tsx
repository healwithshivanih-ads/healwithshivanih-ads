"use client";

/**
 * RenewalQueuePanel — who is coming to the end of their plan, the letter waiting
 * to go to them, and the buttons that say what was decided.
 *
 * The queue itself has existed since 3 Aug 2026 and the digest has been telling
 * the coach to "approve the letter here and it goes out on the day" ever since —
 * with nowhere to read a letter and nothing to approve. This panel closes that
 * loop: a letter authored in chat is staged as a draft, shows up here with a
 * "Read & approve" expander, and approving it sets it to send on the plan-end
 * day (the renewal-send cron does the mailing). The three decision buttons are
 * still here for the case where a plan ends and no letter is going out at all.
 *
 * Does NOT self-hide the way the archive panel does. An empty renewals list is
 * a real, reassuring answer ("nobody is ending soon") and the end of a plan is
 * too commercially significant for its absence and its silence to look alike.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  recordRenewalDecisionAction,
  undoRenewalDecisionAction,
} from "@/lib/server-actions/renewals";
import {
  approveRenewalLetterAction,
  unapproveRenewalLetterAction,
} from "@/lib/server-actions/renewal-letters";
import type { RenewalRow, RenewalDecision } from "@/lib/fmdb/renewal-queue";
import type { RenewalLetter, RenewalLetterStatus } from "@/lib/fmdb/renewal-letters";
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

function humanDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Local overlay of a letter's lifecycle so approve/unapprove update in place
 *  without a refresh that would reorder or drop the row. */
type LetterMark = { status: RenewalLetterStatus; scheduled_for: string | null };

export function RenewalQueuePanel({
  rows,
  letters = {},
}: {
  rows: RenewalRow[];
  letters?: Record<string, RenewalLetter>;
}) {
  const [pending, startTransition] = useTransition();
  const [decided, setDecided] = useState<Record<string, RenewalDecision>>({});
  const [letterMarks, setLetterMarks] = useState<Record<string, LetterMark>>({});
  const [openLetter, setOpenLetter] = useState<string | null>(null);
  // Snapshot the rows ONCE — see the long note in git history: recording a
  // decision removes the row from the server queue by design, so rendering from
  // the live prop would make a row (and its Undo) vanish the instant it's
  // clicked.
  const [visible] = useState(rows);

  const letterFor = (slug: string): { letter: RenewalLetter; mark: LetterMark } | null => {
    const letter = letters[slug];
    if (!letter) return null;
    const mark = letterMarks[slug] ?? { status: letter.status, scheduled_for: letter.scheduled_for };
    return { letter, mark };
  };

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

  function approveLetter(r: RenewalRow) {
    startTransition(async () => {
      const res = await approveRenewalLetterAction(r.planSlug, r.endsOn);
      if (res.ok) {
        setLetterMarks((p) => ({ ...p, [r.planSlug]: { status: "approved", scheduled_for: r.endsOn } }));
        setOpenLetter(null);
        toast.success(`${r.clientName} — approved, sends ${humanDate(r.endsOn)}`);
      } else {
        toast.error(res.error || "Could not approve the letter");
      }
    });
  }

  function unapproveLetter(r: RenewalRow) {
    startTransition(async () => {
      const res = await unapproveRenewalLetterAction(r.planSlug);
      if (res.ok) {
        setLetterMarks((p) => ({ ...p, [r.planSlug]: { status: "drafted", scheduled_for: null } }));
        toast.success(`${r.clientName} — back to draft, will not send`);
      } else {
        toast.error(res.error || "Could not undo the approval");
      }
    });
  }

  const openCount = visible.filter((r) => !decided[r.planSlug]).length;
  const anyUrgent = visible.some((r) => r.daysLeft <= 7 && !decided[r.planSlug]);

  const btnBase: React.CSSProperties = {
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
  };

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
            : "Read each letter and approve it — approved letters send on the plan-end day. Or mark anyone not continuing and they clear from here."}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((r) => {
          const mark = decided[r.planSlug];
          const when = whenLabel(r.daysLeft);
          const lf = letterFor(r.planSlug);
          const isOpen = openLetter === r.planSlug;
          return (
            <div
              key={r.planSlug}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "8px 10px",
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                opacity: mark ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Link
                    href={`/clients-v2/${r.clientId}?tab=plan`}
                    style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}
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
                  {lf && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fm-text-tertiary)" }}>
                      · {lf.mark.status === "approved"
                        ? `✅ letter sends ${lf.mark.scheduled_for ? humanDate(lf.mark.scheduled_for) : "on end date"}`
                        : "📝 draft ready"}
                      {lf.letter.offer_label ? ` · ${lf.letter.offer_label}` : ""}
                    </span>
                  )}
                  {!lf && !mark && (
                    <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)", fontStyle: "italic" }}>
                      · no letter yet — author it in chat
                    </span>
                  )}
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
                    <button type="button" onClick={() => undo(r)} disabled={pending}
                      style={{ border: "none", background: "transparent", color: "var(--fm-text-tertiary)", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: pending ? "wait" : "pointer", fontFamily: "inherit", padding: 0 }}>
                      Undo
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    {lf && (
                      <button type="button" onClick={() => setOpenLetter(isOpen ? null : r.planSlug)} disabled={pending}
                        style={{ ...btnBase, borderColor: "#4a6b4a", color: "#4a6b4a" }}>
                        {isOpen ? "Hide letter" : "Read letter"}
                      </button>
                    )}
                    {lf?.mark.status === "approved" && (
                      <button type="button" onClick={() => unapproveLetter(r)} disabled={pending}
                        style={{ ...btnBase }}>
                        Unapprove
                      </button>
                    )}
                    {CHOICES.map((c) => (
                      <button key={c.key} type="button" title={c.hint} onClick={() => decide(r, c.key)} disabled={pending} style={btnBase}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isOpen && lf && (
                <div
                  style={{
                    borderTop: "1px solid var(--fm-border-light)",
                    paddingTop: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
                    To {lf.letter.to} · {lf.letter.subject}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "var(--fm-text-primary)",
                      whiteSpace: "pre-wrap",
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      maxHeight: 260,
                      overflowY: "auto",
                      background: "var(--fm-bg, #fff)",
                      border: "1px solid var(--fm-border-light)",
                      borderRadius: "var(--fm-radius-sm)",
                      padding: "10px 12px",
                    }}
                  >
                    {lf.letter.body}
                  </div>
                  {lf.mark.status === "drafted" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => approveLetter(r)} disabled={pending}
                        style={{ ...btnBase, background: "#4a6b4a", color: "#fff", borderColor: "#4a6b4a", padding: "6px 14px" }}>
                        Approve — sends {humanDate(r.endsOn)}
                      </button>
                      <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>
                        Nothing goes out until the plan-end day. Undo anytime before then.
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4a6b4a" }}>
                      ✅ Approved — sends {lf.mark.scheduled_for ? humanDate(lf.mark.scheduled_for) : "on the plan-end day"}.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FmPanel>
  );
}
