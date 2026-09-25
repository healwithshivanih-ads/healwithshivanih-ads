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
 * Like the win-back panel, a draft must be opened to be sent: a one-click
 * "Send" on a collapsed row would be approval without reading.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  approveFollowupDraftAction,
  skipFollowupTouchAction,
  stopFollowupAction,
  startFollowupAction,
  type FollowupDraftRow,
  type FollowupScheduledRow,
  type FollowupUnanchoredRow,
} from "@/lib/server-actions/discovery-followup";
import { TOUCH_LABEL, humanDate, MAX_MESSAGE_CHARS } from "@/lib/fmdb/discovery-followup";
import { FmPanel } from "@/components/fm";

const TRACK_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  free: { label: "Free call", bg: "rgba(43,45,66,0.08)", fg: "#2b2d42" },
  foundation: { label: "Foundation ₹12k", bg: "rgba(107,142,107,0.15)", fg: "#3f5f3f" },
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
  const [msg, setMsg] = useState(row.message);
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
          {row.missingStartingMap && (
            <div style={{ fontSize: 12, color: "#8a5a12", background: "rgba(217,131,36,0.10)", border: "1px solid rgba(217,131,36,0.35)", borderRadius: "var(--fm-radius-sm)", padding: "7px 10px" }}>
              {first}&rsquo;s Starting Map isn&rsquo;t written yet, so this message has no app link. Write it on
              their overview first and the next scan can link it — or send this version now.
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
            WhatsApp reads: <em>&ldquo;Hi {first}, a quick note from my side:</em> [your text]{" "}
            <em>Reply here whenever you can and I&rsquo;ll update your record.&rdquo;</em> One paragraph — no line breaks.
          </div>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={6}
            style={{ padding: "8px 10px", fontSize: 13, lineHeight: 1.55, fontFamily: "inherit", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: msg.length > MAX_MESSAGE_CHARS ? "#b3402a" : "var(--fm-text-tertiary)" }}>
            {msg.length}/{MAX_MESSAGE_CHARS}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              disabled={pending || !msg.trim()}
              onClick={() => run(() => approveFollowupDraftAction(row.clientId, row.touch, msg), `Sent to ${row.clientName}`)}
              style={{ ...pill, border: "none", background: pending ? "var(--fm-border)" : "#6b8e6b", color: "#fff", padding: "6px 16px" }}
            >
              {pending ? "Sending…" : "Approve & send on WhatsApp"}
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

function StartByHand({ row }: { row: FollowupUnanchoredRow }) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span style={{ fontSize: 11.5, color: "#3f5f3f" }}>started ✓</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ fontSize: 11.5, padding: "2px 4px", border: "1px solid var(--fm-border)", borderRadius: 4, fontFamily: "inherit" }}
      />
      <button
        type="button"
        disabled={!date || pending}
        title="Start the FREE-call follow-up from this date. For a Foundation session use 'Mark discovery call done' on their overview."
        onClick={() =>
          startTransition(async () => {
            const res = await startFollowupAction(row.clientId, date);
            if (res.ok) {
              toast.success(`Follow-up started for ${row.clientName} — drafts at the next scan`);
              setDone(true);
            } else toast.error(res.error || "Could not start");
          })
        }
        style={{ ...pill, padding: "2px 9px", fontSize: 11, border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-secondary)" }}
      >
        Free call on this date
      </button>
    </span>
  );
}

export function DiscoveryFollowupPanel({
  drafts,
  scheduled,
  unanchored,
}: {
  drafts: FollowupDraftRow[];
  scheduled: FollowupScheduledRow[];
  unanchored: FollowupUnanchoredRow[];
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = drafts.filter((d) => !done.has(`${d.clientId}:${d.touch}`));
  if (visible.length === 0 && scheduled.length === 0 && unanchored.length === 0) return null;

  return (
    <FmPanel style={{ background: "rgba(107,142,107,0.05)", borderColor: "rgba(107,142,107,0.3)", padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700, color: "#3f5f3f", display: "flex", gap: 6 }}>
          <span>🌱</span>
          <span>Call follow-ups ({visible.length})</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 3 }}>
          People who had a call and haven&rsquo;t signed up. Free call → offer the Foundation session (no
          credit). Foundation → the programme, with their ₹12,000 credit date. Nothing goes out until you send it.
        </div>
      </div>

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
            If they had a free call, give its date. If they had the paid Foundation session, use
            &ldquo;Mark discovery call done&rdquo; on their overview instead — that starts their credit.
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {unanchored.map((u) => (
              <li key={u.clientId} style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginBottom: 4 }}>
                <Link href={`/clients-v2/${u.clientId}`} style={{ color: "var(--fm-text-primary)", fontWeight: 600, textDecoration: "none" }}>
                  {u.clientName}
                </Link>{" "}
                — {u.reason} <StartByHand row={u} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </FmPanel>
  );
}
