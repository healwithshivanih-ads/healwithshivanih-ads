"use client";

/**
 * InterestedPeoplePanel — everyone who has booked or talked to us recently and
 * not signed up, with what they told us they care about.
 *
 * Three jobs:
 *   1. See at a glance what each person came in with (concern chips + their
 *      own words), and correct it: × takes a concern off (it stays recorded as
 *      dismissed, so nothing automatic puts it back), + adds one.
 *   2. See the one video or guide that would suit them next.
 *   3. Send or skip a "thought of you" note when a new matching item has gone
 *      live — drafted by the 10:45 cron, never sent without opening it.
 *
 * Self-hides when nobody is in the window.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  addConcernAction,
  approveInterestNoteAction,
  removeConcernAction,
  setNotesOptOutAction,
  skipInterestNoteAction,
  type InterestedPersonRow,
} from "@/lib/server-actions/interest-tracking";
import { CONCERN_IDS, CONCERN_LABEL } from "@/lib/fmdb/concerns";
import { FmPanel } from "@/components/fm";

const pill = {
  borderRadius: "var(--fm-radius-pill)",
  padding: "5px 14px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

const chip = {
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 4px 2px 9px",
  borderRadius: "var(--fm-radius-pill)",
  background: "rgba(43,45,66,0.07)",
  color: "var(--fm-text-primary)",
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
} as const;

function humanDay(ymd: string | null): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function NoteCard({ row, onDone }: { row: InterestedPersonRow; onDone: () => void }) {
  const note = row.pendingNote!;
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(note.subject);
  const [body, setBody] = useState(note.body);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okText);
        onDone();
      } else toast.error(r.error || "Something went wrong");
    });
  }

  return (
    <div style={{ padding: "10px 12px", background: "var(--fm-surface)", border: "1px solid var(--fm-border-light)", borderRadius: "var(--fm-radius-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/clients-v2/${row.clientId}`} style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}>
          {row.name}
        </Link>
        <span style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
          New for them: 🎬 {note.title}
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
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            style={{ padding: "6px 9px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            aria-label="Email"
            style={{ padding: "8px 9px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveInterestNoteAction(row.clientId, { subject, body }), `Sent to ${row.name.split(" ")[0]}`)}
              style={{ ...pill, border: "none", background: "#3f5f3f", color: "#fff", opacity: pending ? 0.6 : 1 }}
            >
              {pending ? "Sending…" : "Send email"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => skipInterestNoteAction(row.clientId), "Skipped")}
              style={{ ...pill, border: "1px solid var(--fm-border)", background: "transparent", color: "var(--fm-text-secondary)" }}
            >
              Skip this one
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setNotesOptOutAction(row.clientId, true), "No more notes for them")}
              style={{ ...pill, border: "1px solid var(--fm-border)", background: "transparent", color: "#b3402a" }}
            >
              Stop these notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonRow({ row }: { row: InterestedPersonRow }) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState("");
  const have = new Set(row.concerns.map((c) => c.id));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error || "Something went wrong");
    });
  }

  return (
    <li style={{ padding: "8px 0", borderTop: "1px solid var(--fm-border-light)", listStyle: "none", opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Link href={`/clients-v2/${row.clientId}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}>
          {row.name}
        </Link>
        {row.parked && (
          <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-pill)", padding: "0 6px" }}>
            parked
          </span>
        )}
        {row.concerns.map((c) => (
          <span key={c.id} style={chip}>
            {c.label}
            <button
              type="button"
              title={`Take "${c.label}" off`}
              aria-label={`Remove ${c.label}`}
              disabled={pending}
              onClick={() => run(() => removeConcernAction(row.clientId, c.id))}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--fm-text-tertiary)", padding: "0 4px" }}
            >
              ×
            </button>
          </span>
        ))}
        <select
          value={adding}
          disabled={pending}
          aria-label="Add a concern"
          onChange={(e) => {
            const v = e.target.value;
            setAdding("");
            if (v) run(() => addConcernAction(row.clientId, v));
          }}
          style={{ fontSize: 11, padding: "1px 4px", border: "1px dashed var(--fm-border)", borderRadius: "var(--fm-radius-pill)", background: "transparent", color: "var(--fm-text-secondary)", fontFamily: "inherit" }}
        >
          <option value="">+ concern</option>
          {CONCERN_IDS.filter((id) => !have.has(id)).map((id) => (
            <option key={id} value={id}>
              {CONCERN_LABEL[id]}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--fm-text-tertiary)" }}>last contact {humanDay(row.lastActivityOn)}</span>
      </div>
      {row.words[0] && (
        <div style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--fm-text-secondary)", marginTop: 3 }}>
          &ldquo;{row.words[0].length > 140 ? `${row.words[0].slice(0, 140)}…` : row.words[0]}&rdquo;
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>{row.followupStatus}</span>
        {row.optedOut ? (
          <span>
            · no content notes{row.optOutSource && row.optOutSource !== "coach" ? ` (${row.optOutSource})` : ""}{" "}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setNotesOptOutAction(row.clientId, false))}
              style={{ border: "none", background: "transparent", color: "var(--fm-text-tertiary)", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0 }}
            >
              undo
            </button>
          </span>
        ) : row.suggestion ? (
          <span>
            · best next:{" "}
            <a href={row.suggestion.url} target="_blank" rel="noreferrer" style={{ color: "var(--fm-text-primary)" }}>
              {row.suggestion.kind === "guide" ? "📘" : "🎬"} {row.suggestion.title}
            </a>
          </span>
        ) : row.concerns.length ? (
          <span>· nothing live yet that fits</span>
        ) : (
          <span>· no concern tagged — add one so we know what to send</span>
        )}
      </div>
    </li>
  );
}

export function InterestedPeoplePanel({
  rows,
  contentCheckedAt,
}: {
  rows: InterestedPersonRow[];
  contentCheckedAt: string | null;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  if (rows.length === 0) return null;
  // The only failure that would make this quietly stop suggesting anything.
  const checkedMs = contentCheckedAt ? Date.parse(contentCheckedAt) : NaN;
  const stale = Number.isNaN(checkedMs) || Date.now() - checkedMs > 2 * 864e5;
  const notes = rows.filter((r) => r.pendingNote && !done.has(r.clientId));

  return (
    <FmPanel style={{ background: "rgba(43,45,66,0.03)", borderColor: "rgba(43,45,66,0.18)", padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700, color: "var(--fm-text-primary)", display: "flex", gap: 6 }}>
          <span>💬</span>
          <span>Interested people ({rows.length})</span>
          {notes.length > 0 && <span style={{ color: "#3f5f3f" }}>· {notes.length} note{notes.length === 1 ? "" : "s"} to send</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", marginTop: 3 }}>
          Everyone who booked or talked to us in the last 90 days and hasn&rsquo;t signed up, with what they came in
          with. When a new video or guide matches a quiet person, a short note waits here. Nothing goes out until you send it.
        </div>
      </div>

      {stale && (
        <div style={{ fontSize: 12, color: "#8a5a12", background: "rgba(217,131,36,0.10)", border: "1px solid rgba(217,131,36,0.35)", borderRadius: "var(--fm-radius-sm)", padding: "7px 10px", marginBottom: 10 }}>
          The daily YouTube check hasn&rsquo;t run since {contentCheckedAt ? contentCheckedAt.slice(0, 10) : "it was set up"}, so no
          videos are being suggested. It runs at 10:35 — if this stays, the cron needs a look.
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {notes.map((r) => (
            <NoteCard key={r.clientId} row={r} onDone={() => setDone((p) => new Set(p).add(r.clientId))} />
          ))}
        </div>
      )}

      <details open={notes.length === 0}>
        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--fm-text-secondary)" }}>
          Who&rsquo;s interested in what
        </summary>
        <ul style={{ margin: "6px 0 0", padding: 0 }}>
          {rows.map((r) => (
            <PersonRow key={r.clientId} row={r} />
          ))}
        </ul>
      </details>
    </FmPanel>
  );
}
