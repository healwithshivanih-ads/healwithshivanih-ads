"use client";

/**
 * DiscoveryFollowupPanel — follow-ups for people who had a call and have not
 * signed up, and the only place those messages can be sent from.
 *
 * Two tracks, labelled on every row so the coach never has to work out which
 * offer applies: FREE CALL (next step = Foundation session, no credit) and
 * FOUNDATION (next step = programme, ₹12,000 credit until a date). The send
 * gate refuses credit wording on a free-call message, but the label is what
 * stops her writing it in the first place.
 *
 * Email only (coach decision 2026-09-25). Like the win-back panel, a draft must be opened to be sent: a one-click
 * "Send" on a collapsed row would be approval without reading.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  approveFollowupDraftAction,
  skipFollowupTouchAction,
  stopFollowupAction,
  resolveTriagePaymentAction,
  dismissTriagePaymentAction,
  type FollowupDraftRow,
  type FollowupScheduledRow,
  type FollowupUnanchoredRow,
} from "@/lib/server-actions/discovery-followup";
import type { UnplacedTriagePayment } from "@/lib/fmdb/triage-payment-intake";
import { TOUCH_LABEL, humanDate, MAX_BODY_CHARS } from "@/lib/fmdb/discovery-followup";
import { CallKindRecorder } from "@/components/call-kind-recorder";
import { FmPanel } from "@/components/fm";

const TRACK_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  free: { label: "Free call · no credit", bg: "rgba(43,45,66,0.08)", fg: "#2b2d42" },
  triage: { label: "Paid ₹999 call · Foundation ₹11,001", bg: "rgba(217,131,36,0.12)", fg: "#8a5a12" },
  foundation: { label: "Paid Foundation · ₹12k credit", bg: "rgba(107,142,107,0.15)", fg: "#3f5f3f" },
};

const pill = {
  borderRadius: "var(--fm-radius-pill)",
  padding: "5px 14px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

function TrackChip({ track }: { track: string }) {
  const t = TRACK_CHIP[track] ?? TRACK_CHIP.free;
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: "var(--fm-radius-pill)",
        background: t.bg,
        color: t.fg,
      }}
    >
      {t.label}
    </span>
  );
}

function DraftCard({ row, onDone }: { row: FollowupDraftRow; onDone: (k: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const key = `${row.clientId}:${row.touch}`;
  const first = row.clientName.split(" ")[0];

  function run(fn: () => Promise<{ ok: boolean; error?: string; warnings?: string[] }>, okText: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okText);
        res.warnings?.forEach((w) => toast.warning(w));
        onDone(key);
      } else toast.error(res.error || "Something went wrong");
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
          href={`/clients-v2/${row.clientId}`}
          style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}
        >
          {row.clientName}
        </Link>
        <TrackChip track={row.track} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fm-text-secondary)" }}>
          {row.touch} of 4 · {TOUCH_LABEL[row.kind] ?? row.kind}
        </span>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          · call {humanDate(row.callDate)} ({row.daysSinceCall}d ago)
          {row.creditExpiresOn ? ` · credit until ${humanDate(row.creditExpiresOn)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ ...pill, marginLeft: "auto", border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-secondary)", padding: "3px 11px" }}
        >
          {open ? "Hide" : "Read & send"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {row.unconfirmedKind && (
            <details style={{ fontSize: 12, background: "rgba(43,45,66,0.05)", borderRadius: "var(--fm-radius-sm)", padding: "7px 10px" }}>
              <summary style={{ cursor: "pointer" }}>
                Worked out from a 15-minute booking — was it the free call or the paid ₹999 one? Confirm before sending.
              </summary>
              <div style={{ marginTop: 8 }}>
                <CallKindRecorder clientId={row.clientId} clientName={row.clientName} compact />
              </div>
            </details>
          )}
          {row.missingStartingMap && (
            <div style={{ fontSize: 12, color: "#8a5a12", background: "rgba(217,131,36,0.10)", border: "1px solid rgba(217,131,36,0.35)", borderRadius: "var(--fm-radius-sm)", padding: "7px 10px" }}>
              {first}&rsquo;s Starting Map isn&rsquo;t written yet, so this email has no app link. Write it on
              their overview first and the next scan can link it — or send this version now.
            </div>
          )}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            style={{ padding: "6px 9px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            aria-label="Email"
            style={{ padding: "8px 10px", fontSize: 13, lineHeight: 1.55, fontFamily: "inherit", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: body.length > MAX_BODY_CHARS ? "#b3402a" : "var(--fm-text-tertiary)" }}>
            Sent by email from your address, with a copy to you. {body.length}/{MAX_BODY_CHARS}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              disabled={pending || !subject.trim() || !body.trim()}
              onClick={() => run(() => approveFollowupDraftAction(row.clientId, row.touch, { subject, body }), `Emailed ${row.clientName}`)}
              style={{ ...pill, border: "none", background: pending ? "var(--fm-border)" : "#6b8e6b", color: "#fff", padding: "6px 16px" }}
            >
              {pending ? "Sending…" : "Approve & email"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => skipFollowupTouchAction(row.clientId, row.touch), `Skipped for ${row.clientName}`)}
              style={{ ...pill, border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-secondary)" }}
            >
              Skip this one
            </button>
            <button
              type="button"
              disabled={pending}
              title="No further follow-ups for this person"
              onClick={() => run(() => stopFollowupAction(row.clientId), `Stopped follow-up for ${row.clientName}`)}
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#b3402a", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
            >
              Stop following up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A ₹999 funnel payment the pipe could not put on anyone. The coach picks the
 * person (one of the matches, or any client id) — or dismisses it.
 */
function UnplacedTriageRow({ p, onDone }: { p: UnplacedTriagePayment; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [other, setOther] = useState("");
  const place = (clientId: string, name: string) =>
    startTransition(async () => {
      const r = await resolveTriagePaymentAction(p.paymentId, clientId);
      if (r.ok) {
        toast.success(`₹999 credit placed on ${name} — their Foundation session is now ₹11,001`);
        onDone();
      } else toast.error(r.error || "Could not place it");
    });
  const dismiss = () =>
    startTransition(async () => {
      const r = await dismissTriagePaymentAction(p.paymentId);
      if (r.ok) {
        toast.success("Dismissed — no credit placed");
        onDone();
      } else toast.error(r.error || "Could not dismiss");
    });
  return (
    <div style={{ padding: "9px 11px", background: "var(--fm-surface)", border: "1px solid rgba(179,64,42,0.35)", borderRadius: "var(--fm-radius-sm)", display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12.5 }}>
        <strong>{p.name || "Someone"}</strong> paid ₹{p.amountInr} on {humanDate(p.paidAt.slice(0, 10))}
        <span style={{ color: "var(--fm-text-tertiary)" }}>
          {" "}· {p.email ?? "no email"}{p.phoneLast4 ? ` · phone …${p.phoneLast4}` : ""} · {p.paymentId}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#8a5a12" }}>
        {p.outcome === "conflict"
          ? "Their email and phone match different people, so the credit wasn't placed. Whose is it?"
          : "Too little contact detail to match anyone. Whose is it?"}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {p.candidates.map((c) => (
          <button
            key={`${c.clientId}-${c.matchedBy}`}
            type="button"
            disabled={pending}
            onClick={() => place(c.clientId, c.name)}
            style={{ ...pill, border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-primary)", padding: "3px 11px" }}
          >
            {c.name} ({c.clientId}, {c.matchedBy} matches)
          </button>
        ))}
        <input
          value={other}
          onChange={(e) => setOther(e.target.value.trim())}
          placeholder="or client id, e.g. cl-912"
          style={{ fontSize: 11.5, padding: "3px 6px", width: 150, border: "1px solid var(--fm-border)", borderRadius: 6, fontFamily: "inherit" }}
        />
        <button
          type="button"
          disabled={pending || !/^[A-Za-z0-9_-]+$/.test(other)}
          onClick={() => place(other, other)}
          style={{ ...pill, border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-secondary)", padding: "3px 11px" }}
        >
          Place on this client
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={dismiss}
          title="Refund, test payment, or otherwise no credit to place"
          style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#b3402a", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function DiscoveryFollowupPanel({
  drafts,
  scheduled,
  unanchored,
  unplacedTriage = [],
}: {
  drafts: FollowupDraftRow[];
  scheduled: FollowupScheduledRow[];
  unanchored: FollowupUnanchoredRow[];
  unplacedTriage?: UnplacedTriagePayment[];
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = drafts.filter((d) => !done.has(`${d.clientId}:${d.touch}`));
  const unplaced = unplacedTriage.filter((p) => !done.has(`triage:${p.paymentId}`));
  if (visible.length === 0 && scheduled.length === 0 && unanchored.length === 0 && unplaced.length === 0) return null;

  return (
    <FmPanel style={{ background: "rgba(107,142,107,0.05)", borderColor: "rgba(107,142,107,0.3)", padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700, color: "#3f5f3f", display: "flex", gap: 6 }}>
          <span>🌱</span>
          <span>Call follow-ups ({visible.length})</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 3 }}>
          Emails for people who had a call and haven&rsquo;t signed up. Free call → offer the Foundation
          session (no credit). Paid Foundation → the programme, with their ₹12,000 credit date. Nothing goes out until you send it.
        </div>
      </div>

      {unplaced.length > 0 && (
        <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#b3402a" }}>
            ⚠ ₹999 payments to place ({unplaced.length})
          </div>
          {unplaced.map((p) => (
            <UnplacedTriageRow
              key={p.paymentId}
              p={p}
              onDone={() => setDone((prev) => new Set(prev).add(`triage:${p.paymentId}`))}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((d) => (
          <DraftCard key={`${d.clientId}:${d.touch}`} row={d} onDone={(k) => setDone((p) => new Set(p).add(k))} />
        ))}
      </div>

      {scheduled.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
            🕒 In follow-up ({scheduled.length})
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {scheduled.map((s) => (
              <li key={s.clientId} style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginBottom: 2 }}>
                <Link href={`/clients-v2/${s.clientId}`} style={{ color: "var(--fm-text-primary)", fontWeight: 600, textDecoration: "none" }}>
                  {s.clientName}
                </Link>{" "}
                <TrackChip track={s.track} /> — call {humanDate(s.callDate)} · {s.status}
                {s.nextDueOn ? ` · next draft ${humanDate(s.nextDueOn)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unanchored.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
            ❔ Not signed up, no call on record ({unanchored.length})
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 2 }}>
            Had a call? Record whether it was the free discovery call (no credit), the paid ₹999 short
            call (Foundation becomes ₹11,001), or the paid ₹12,000 Foundation session (starts their 15-day credit).
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {unanchored.map((u) => (
              <li key={u.clientId} style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginBottom: 4 }}>
                <Link href={`/clients-v2/${u.clientId}`} style={{ color: "var(--fm-text-primary)", fontWeight: 600, textDecoration: "none" }}>
                  {u.clientName}
                </Link>{" "}
                — {u.reason}
                <details style={{ margin: "4px 0 6px" }}>
                  <summary style={{ fontSize: 11.5, cursor: "pointer", color: "var(--fm-text-secondary)" }}>Record their call</summary>
                  <div style={{ marginTop: 6 }}>
                    <CallKindRecorder clientId={u.clientId} clientName={u.clientName} triagePaidOn={u.triagePaidOn} compact />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FmPanel>
  );
}
