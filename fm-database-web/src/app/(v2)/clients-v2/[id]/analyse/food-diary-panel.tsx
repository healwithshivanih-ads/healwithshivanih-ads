"use client";

/**
 * Food diary — the coach's side on the Record tab (docs/FOOD_DIARY_PLAN.md).
 *
 * Start / extend / end a diary, get the WhatsApp line to send yourself, and
 * see what came in: one column per diary day, one row per part of the day.
 *
 * This is a place to LOOK, not a queue to work through. The coach decided
 * (2026-10-23) she is not the interpreter: from phase 2 every photo is read
 * automatically and only an unreadable one reaches her. Correcting a photo
 * here is optional, and her correction always wins over any AI reading.
 *
 * Nothing on this panel sends anything. "Open WhatsApp" opens her own
 * WhatsApp with the line filled in; she presses send.
 */

import { useState, useTransition } from "react";
import { FmPanel } from "@/components/fm";
import {
  DIARY_BANDS,
  DIARY_BAND_LABEL,
  DIARY_DEFAULT_DAYS,
  DIARY_MAX_DAYS,
  type DiaryEntry,
} from "@/lib/fmdb/food-diary";
import {
  endFoodDiaryAction,
  extendFoodDiaryAction,
  labelDiaryEntryAction,
  loadFoodDiaryAction,
  markFoodDiaryReviewedAction,
  startFoodDiaryAction,
  type DiaryPanelData,
} from "@/lib/server-actions/food-diary";

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function clock(t: string): string {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const btn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 12px",
  borderRadius: "var(--fm-radius-sm)",
  border: "1px solid var(--fm-border)",
  background: "var(--fm-surface)",
  color: "var(--fm-text-primary)",
  cursor: "pointer",
};
const primary: React.CSSProperties = { ...btn, background: "var(--fm-primary)", color: "#fff", border: "none" };

export function FoodDiaryPanel({ clientId, initial }: { clientId: string; initial: DiaryPanelData }) {
  const [data, setData] = useState<DiaryPanelData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<DiaryEntry | null>(null);
  const [pending, start] = useTransition();
  const [showStart, setShowStart] = useState(false);

  const cfg = data.config;
  const running = data.phase === "running" || data.phase === "upcoming";
  const finished = data.phase === "finished";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That didn't work.");
        return;
      }
      setError(null);
      after?.();
      const fresh = await loadFoodDiaryAction(clientId);
      if (fresh.ok) setData(fresh);
    });
  }

  const waHref = (text: string) => {
    const digits = (data.mobile ?? "").replace(/\D/g, "");
    const to = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  };
  const shownMessage = message ?? (running ? data.message : null);

  return (
    <div id="food-diary" style={{ scrollMarginTop: 16 }}>
    <FmPanel style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1 }}>🍽 Food diary</h3>
        {cfg && running && (
          <>
            <button style={btn} disabled={pending || cfg.days >= DIARY_MAX_DAYS} onClick={() => run(() => extendFoodDiaryAction(clientId))}>
              ＋1 day
            </button>
            <button style={btn} disabled={pending} onClick={() => run(() => endFoodDiaryAction(clientId))}>
              End diary
            </button>
          </>
        )}
        {finished && cfg && !cfg.reviewed_at && (
          <button style={primary} disabled={pending} onClick={() => run(() => markFoodDiaryReviewedAction(clientId))}>
            Mark reviewed
          </button>
        )}
        {(!cfg || finished) && !showStart && (
          <button style={cfg ? btn : primary} onClick={() => setShowStart(true)} disabled={!data.appUrl}>
            {cfg ? "Start a new diary" : "Start food diary"}
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--fm-text-secondary)", margin: "6px 0 0" }}>
        {cfg ? (
          <>
            {running ? (data.phase === "upcoming" ? "Starts" : "Running") : "Finished"} · {fmtDay(cfg.start)} – {fmtDay(data.lastDay ?? cfg.start)} ·{" "}
            {data.total} photo{data.total === 1 ? "" : "s"}
            {cfg.focus && <> · looking for: {cfg.focus}</>}
            {finished && cfg.reviewed_at && <> · reviewed</>}
          </>
        ) : data.appUrl ? (
          "The client snaps every meal in the app for a few days you pick; you see it here, day by day."
        ) : (
          "This client has no app link yet — the diary lives in the app."
        )}
      </p>

      {showStart && (
        <StartForm
          today={data.today}
          pending={pending}
          onCancel={() => setShowStart(false)}
          onStart={(input) =>
            start(async () => {
              const r = await startFoodDiaryAction(clientId, input);
              if (!r.ok) {
                setError(r.error);
                return;
              }
              setError(null);
              setMessage(r.message);
              setShowStart(false);
              const fresh = await loadFoodDiaryAction(clientId);
              if (fresh.ok) setData(fresh);
            })
          }
        />
      )}

      {error && <p style={{ color: "var(--fm-danger, #b42318)", fontSize: 12, margin: "8px 0 0" }}>{error}</p>}

      {shownMessage && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--fm-bg-cool)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Send this yourself — nothing goes out automatically
          </div>
          <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "6px 0 10px" }}>{shownMessage}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={btn}
              onClick={() => {
                void navigator.clipboard?.writeText(shownMessage).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            {data.mobile && (
              <a style={{ ...primary, textDecoration: "none" }} href={waHref(shownMessage)} target="_blank" rel="noopener noreferrer">
                Open WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      {cfg && data.grid.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 92 }} />
                {data.grid.map((d) => (
                  <th key={d.date} style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, whiteSpace: "nowrap" }}>
                    Day {d.dayNumber} · {fmtDay(d.date)}
                    {data.daysDone.includes(d.date) && (
                      <span title="The client marked this day done" style={{ color: "var(--fm-success, #1e8449)", marginLeft: 4 }}>
                        ✓
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIARY_BANDS.map((band) => (
                <tr key={band} style={{ borderTop: "1px solid var(--fm-border-light)" }}>
                  <td style={{ padding: "8px 6px", color: "var(--fm-text-secondary)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {DIARY_BAND_LABEL[band]}
                  </td>
                  {data.grid.map((d) => {
                    const cell = d.bands.find((b) => b.band === band)?.entries ?? [];
                    return (
                      <td key={d.date} style={{ padding: "6px", verticalAlign: "top" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {cell.map((e) => (
                            <button
                              key={e.entry_id}
                              onClick={() => setOpen(e)}
                              title={[clock(e.time), e.note, e.coach_label].filter(Boolean).join(" · ")}
                              style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in", textAlign: "left", width: 76 }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- client diary photo, served from the coach host */}
                              <img
                                src={`/api/client-file/${clientId}/${e.photo}?dir=diary`}
                                alt={e.coach_label || e.note || "diary photo"}
                                style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 6, border: "1px solid var(--fm-border-light)", display: "block" }}
                              />
                              <span style={{ display: "block", fontSize: 10.5, color: "var(--fm-text-tertiary)", marginTop: 2 }}>
                                {clock(e.time)}
                              </span>
                              {(e.coach_label || e.note) && (
                                <span style={{ display: "block", fontSize: 10.5, color: "var(--fm-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {e.coach_label || e.note}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <PhotoViewer
          clientId={clientId}
          entry={open}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            const fresh = await loadFoodDiaryAction(clientId);
            if (fresh.ok) setData(fresh);
            setOpen(null);
          }}
        />
      )}
    </FmPanel>
    </div>
  );
}

function StartForm({
  today,
  pending,
  onStart,
  onCancel,
}: {
  today: string;
  pending: boolean;
  onStart: (input: { start: string; days: number; focus: string }) => void;
  onCancel: () => void;
}) {
  const [startOn, setStartOn] = useState(today);
  const [days, setDays] = useState(DIARY_DEFAULT_DAYS);
  const [focus, setFocus] = useState("");
  const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--fm-text-secondary)" };
  const input: React.CSSProperties = { fontSize: 13, padding: "6px 8px", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" };
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
      <label style={label}>
        Start
        <input type="date" min={today} value={startOn} onChange={(e) => setStartOn(e.target.value)} style={input} />
      </label>
      <label style={label}>
        Days
        <input
          type="number"
          min={1}
          max={DIARY_MAX_DAYS}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ ...input, width: 64 }}
        />
      </label>
      <label style={{ ...label, flex: 1, minWidth: 180 }}>
        Looking for (only you see this)
        <input
          placeholder="e.g. protein, what she snacks on"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          style={input}
        />
      </label>
      <button style={primary} disabled={pending} onClick={() => onStart({ start: startOn, days, focus })}>
        Start diary
      </button>
      <button style={btn} onClick={onCancel}>
        Cancel
      </button>
      <p style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--fm-text-tertiary)", margin: 0 }}>
        Tip: include one weekend day — weekdays and weekends rarely look alike.
      </p>
    </div>
  );
}

function PhotoViewer({
  clientId,
  entry,
  onClose,
  onSaved,
}: {
  clientId: string;
  entry: DiaryEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(entry.coach_label ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--fm-surface)", borderRadius: "var(--fm-radius-md)", maxWidth: 720, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 16 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- client diary photo */}
        <img
          src={`/api/client-file/${clientId}/${entry.photo}?dir=diary`}
          alt={entry.note || "diary photo"}
          style={{ width: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 8, background: "#111" }}
        />
        <div style={{ fontSize: 13, marginTop: 10 }}>
          <strong>
            {DIARY_BAND_LABEL[entry.band]} · {fmtDay(entry.date)} · {clock(entry.time)}
          </strong>
          {entry.note && <div style={{ color: "var(--fm-text-secondary)", marginTop: 4 }}>Client: “{entry.note}”</div>}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--fm-text-secondary)", marginTop: 12 }}>
          What this is — optional, only if you want to correct it
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 2 moong chilla + mint chutney"
            style={{ fontSize: 13, padding: "7px 9px", border: "1px solid var(--fm-border)", borderRadius: "var(--fm-radius-sm)" }}
          />
        </label>
        {error && <p style={{ color: "var(--fm-danger, #b42318)", fontSize: 12 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button style={btn} onClick={onClose}>
            Close
          </button>
          <button
            style={primary}
            disabled={pending || label.trim() === (entry.coach_label ?? "")}
            onClick={() =>
              start(async () => {
                const r = await labelDiaryEntryAction(clientId, entry.entry_id, label);
                if (!r.ok) setError(r.error);
                else onSaved();
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
