"use client";

/**
 * WinbackDripPanel — the drafted win-back emails, and the only place they can
 * be sent from.
 *
 * WHY IT LOOKS LIKE THIS. Nothing in this drip reaches a client without a click
 * in this panel, so the panel has to make the letter readable rather than
 * merely approvable. A row that showed only "Touch 2 — Archana [Send]" would be
 * approved without being read, which is exactly the same as sending
 * automatically while feeling safer.
 *
 * The price is a REQUIRED input on the offer touch, not a pre-filled guess. No
 * per-client programme price exists anywhere in this codebase; the maintenance
 * figure in the body comes from MAINTENANCE_PRICING (the constant Razorpay
 * bills), but what to quote for a next phase is the coach's alone. The Send
 * button stays disabled until she supplies one — see PRICE_PLACEHOLDER.
 *
 * Skip closes ONE touch. Stop closes the whole drip. They are separate buttons
 * because they are separate decisions: a skipped check-in should not cancel the
 * offer three weeks later.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  approveWinbackDraftAction,
  skipWinbackTouchAction,
  exitWinbackDripAction,
  type WinbackDraftRow,
  type WinbackScheduledRow,
} from "@/lib/server-actions/winback-drip";
import { FmPanel } from "@/components/fm";

const TOUCH_LABEL: Record<string, string> = {
  check_in: "Check-in — no price, no pitch",
  offer: "Next phase + maintenance option",
  maintenance: "Final — maintenance only",
};

function DraftCard({ row, onDone }: { row: WinbackDraftRow; onDone: (k: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [price, setPrice] = useState("");

  const key = `${row.clientId}:${row.touch}`;
  const priceNum = price.trim() ? Number(price.replace(/[^\d]/g, "")) : null;
  // The placeholder is what the gate refuses; test the CURRENT body so a coach
  // who has rewritten the paragraph by hand is not blocked by a stale flag.
  const stillNeedsPrice = body.includes("[ENTER PRICE]");
  const canSend = !pending && subject.trim() !== "" && body.trim() !== "" && !stillNeedsPrice;

  function applyPrice() {
    if (priceNum === null || !Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error("Enter the amount to quote, in rupees");
      return;
    }
    setBody((b) => b.replace(/\[ENTER PRICE\]/g, `₹${priceNum.toLocaleString("en-IN")}`));
    toast.success("Price filled in — read it through before sending");
  }

  function send() {
    startTransition(async () => {
      const res = await approveWinbackDraftAction(row.clientId, row.touch, {
        subject,
        body,
        renewalPriceInr: priceNum,
      });
      if (res.ok) {
        toast.success(`Sent to ${row.clientName}`);
        res.warnings?.forEach((w) => toast.warning(w));
        onDone(key);
      } else {
        toast.error(res.error || "Could not send that");
      }
    });
  }

  function skip() {
    startTransition(async () => {
      const res = await skipWinbackTouchAction(row.clientId, row.touch);
      if (res.ok) {
        toast.success(`Skipped touch ${row.touch} for ${row.clientName}`);
        onDone(key);
      } else toast.error(res.error || "Could not skip that");
    });
  }

  function stop() {
    startTransition(async () => {
      const res = await exitWinbackDripAction(row.clientId);
      if (res.ok) {
        toast.success(`Stopped the drip for ${row.clientName}`);
        onDone(key);
      } else toast.error(res.error || "Could not stop that");
    });
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/clients-v2/${row.clientId}?tab=plan`}
          style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}
        >
          {row.clientName}
        </Link>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fm-text-secondary)" }}>
          touch {row.touch} of 3 · {TOUCH_LABEL[row.kind] ?? row.kind}
        </span>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          · ended {row.daysSinceEnd}d ago
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginLeft: "auto",
            border: "1px solid var(--fm-border)",
            background: "transparent",
            color: "var(--fm-text-secondary)",
            borderRadius: "var(--fm-radius-pill)",
            padding: "3px 11px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "Hide" : "Read & send"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {stillNeedsPrice && (
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                flexWrap: "wrap",
                background: "rgba(217, 131, 36, 0.10)",
                border: "1px solid rgba(217, 131, 36, 0.35)",
                borderRadius: "var(--fm-radius-sm)",
                padding: "8px 10px",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8a5a12" }}>
                What should {row.clientName.split(" ")[0]} be quoted for a next phase?
              </span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 45000"
                inputMode="numeric"
                style={{
                  width: 110,
                  padding: "4px 8px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              />
              <button
                type="button"
                onClick={applyPrice}
                style={{
                  border: "none",
                  background: "#d98324",
                  color: "#fff",
                  borderRadius: "var(--fm-radius-pill)",
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Fill in
              </button>
              <span style={{ fontSize: 11, color: "#8a5a12", width: "100%" }}>
                The maintenance figure in the letter comes from the checkout and is already correct.
                This is only the programme price, which is yours to set.
              </span>
            </div>
          )}

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{
              padding: "6px 9px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            style={{
              padding: "8px 10px",
              fontSize: 13,
              lineHeight: 1.55,
              fontFamily: "inherit",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              title={stillNeedsPrice ? "Fill in the price first" : "Send this email now"}
              style={{
                border: "none",
                background: canSend ? "#6b8e6b" : "var(--fm-border)",
                color: "#fff",
                borderRadius: "var(--fm-radius-pill)",
                padding: "6px 16px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: canSend ? "pointer" : "not-allowed",
                fontFamily: "inherit",
              }}
            >
              {pending ? "Sending…" : "Approve & send"}
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={pending}
              style={{
                border: "1px solid var(--fm-border)",
                background: "transparent",
                color: "var(--fm-text-secondary)",
                borderRadius: "var(--fm-radius-pill)",
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Skip this one
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={pending}
              title="No further win-back emails for this client"
              style={{
                marginLeft: "auto",
                border: "none",
                background: "transparent",
                color: "#b3402a",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "underline",
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              Stop the drip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WinbackDripPanel({
  drafts,
  scheduled,
}: {
  drafts: WinbackDraftRow[];
  scheduled: WinbackScheduledRow[];
}) {
  // Rows leave the list once acted on. Unlike the renewal queue there is no
  // Undo here, because the irreversible action (an email to a client) is
  // already gated behind reading the letter — and Skip only closes one touch of
  // three, so a mis-click costs a message rather than a client.
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = drafts.filter((d) => !done.has(`${d.clientId}:${d.touch}`));

  // Self-hides completely when there is nothing drafted AND nobody scheduled.
  // Unlike "plans ending", an empty win-back list is not a reassuring answer —
  // it is the normal state, and a permanent empty panel is just furniture.
  if (visible.length === 0 && scheduled.length === 0) return null;

  return (
    <FmPanel
      style={{
        background: "rgba(217, 131, 36, 0.05)",
        borderColor: "rgba(217, 131, 36, 0.28)",
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            fontWeight: 700,
            color: "#8a5a12",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>✉️</span>
          <span>Win-back drafts ({visible.length})</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 3 }}>
          {visible.length === 0
            ? "Nothing to approve today."
            : "Clients whose plan ended and was never picked up. Read each one, then send — nothing goes out on its own."}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((d) => (
          <DraftCard
            key={`${d.clientId}:${d.touch}`}
            row={d}
            onDone={(k) => setDone((p) => new Set(p).add(k))}
          />
        ))}
      </div>

      {scheduled.length > 0 && (
        <div style={{ marginTop: visible.length ? 12 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
            🕒 In the drip, nothing due yet ({scheduled.length})
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 2 }}>
            They have left the &ldquo;plans ending&rdquo; list. Reach out yourself any time — that
            cancels the drip.
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {scheduled.map((s) => (
              <li key={s.clientId} style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
                <Link
                  href={`/clients-v2/${s.clientId}?tab=plan`}
                  style={{ color: "var(--fm-text-primary)", fontWeight: 600, textDecoration: "none" }}
                >
                  {s.clientName}
                </Link>{" "}
                — ended {s.daysSinceEnd}d ago · touch {s.nextTouch} drafts {s.dueOn}
              </li>
            ))}
          </ul>
        </div>
      )}
    </FmPanel>
  );
}
