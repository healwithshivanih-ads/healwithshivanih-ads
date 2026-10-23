"use client";

/**
 * The food diary card — top of "Your day" while the coach's diary is running
 * (docs/FOOD_DIARY_PLAN.md).
 *
 * One job: make "snap everything you eat" a single tap. Headline, one big
 * button, today's photos, a way to fix a photo, "Done for today". What it
 * deliberately does NOT do:
 *   - show a number about food (no grams, calories or protein — estimates are
 *     coach-only, and clientDiaryView never carries them here);
 *   - reply to a photo or judge it (unlike the chat);
 *   - remind anyone of anything the client did not switch on herself.
 *
 * Every line the client reads is in the second person.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, useOchre } from "./ochre-context";
import { shrinkPhoto } from "./photo-shrink";
import {
  DIARY_BANDS,
  DIARY_BAND_LABEL,
  DIARY_NAME_MAX,
  DIARY_NOTE_MAX,
  DIARY_REMINDERS,
  diaryBandForHour,
  type ClientDiaryEntry,
  type ClientDiaryView,
  type DiaryBand,
} from "@/lib/fmdb/food-diary";

const pad = (n: number) => String(n).padStart(2, "0");
type LiveFields = Pick<ClientDiaryEntry, "marks" | "looksLike" | "yours" | "feedback">;
/** Poll for a photo's marks about once a minute, for up to ~20 minutes. */
const POLL_MS = 60_000;
const POLL_MAX = 20;
const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const bandOfTime = (t: string): DiaryBand => diaryBandForHour(parseInt(t.slice(0, 2), 10) || 0);

/** "13:05" → "1:05 pm" — how a phone shows a time. */
function clock(t: string): string {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${pad(m || 0)} ${h < 12 ? "am" : "pm"}`;
}

function dayLabel(view: ClientDiaryView, ymd: string): string {
  if (ymd === view.today) return "Today";
  const i = view.openDates.indexOf(ymd);
  return i >= 0 ? `Day ${i + 1}` : ymd;
}

type Draft = {
  blob: Blob;
  preview: string;
  band: DiaryBand;
  earlier: boolean;
  date: string;
  time: string;
  note: string;
};

export function FoodDiaryCard() {
  const data = useOchre();
  const view = data.foodDiary;
  if (!view) return null;
  if (view.finished) return <DiaryFinished view={view} />;
  return <DiaryCard view={view} />;
}

/** One strength, at most one fix — observations in the client's own food
 *  words (food-diary-balance.ts::diaryTip). */
function TipLines({ tip }: { tip: NonNullable<ClientDiaryView["tip"]> }) {
  return (
    <div className="diary-tip">
      <p>
        <Icon name="star" size={14} style={{ color: "var(--forest)", flexShrink: 0, marginTop: 3 }} />
        <span>{tip.strength}</span>
      </p>
      {tip.fix && (
        <p>
          <Icon name="sprout" size={14} style={{ color: "var(--ochre)", flexShrink: 0, marginTop: 3 }} />
          <span>{tip.fix}</span>
        </p>
      )}
    </div>
  );
}

/** The diary is over: thank-you, and the tip once the photos have been read. */
function DiaryFinished({ view }: { view: ClientDiaryView }) {
  const data = useOchre();
  const coachFirst = (data.coach?.name || "Your coach").split(" ")[0];
  return (
    <div className="diary" id="food-diary">
      <div className="diary-head">
        <span className="diary-glyph done">
          <Icon name="check" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="diary-title">Food diary done — thank you</div>
          <div className="diary-sub">{coachFirst} will go through it with you.</div>
        </div>
      </div>
      {view.tip && <TipLines tip={view.tip} />}
    </div>
  );
}

const PROTEIN_WORD = { present: "Protein ✓", light: "Light on protein", none: "No protein" } as const;
const VEG_WORD = { present: "Veg ✓", light: "Light on veg", none: "No veg" } as const;

/** "Protein ✓ · Veg ✓ · Carb-heavy" — words only, never a number. */
function Marks({ marks }: { marks: NonNullable<ClientDiaryEntry["marks"]> }) {
  return (
    <span className="diary-marks">
      <span className={"diary-mark p-" + marks.protein}>{PROTEIN_WORD[marks.protein]}</span>
      {marks.veg && <span className={"diary-mark v-" + marks.veg}>{VEG_WORD[marks.veg]}</span>}
      {marks.carbs === "heavy" && <span className="diary-mark carb">Carb-heavy</span>}
    </span>
  );
}

/** One dot per photo today, in time order: filled when the plate had protein,
 *  half when a little, open when none, dashed while it is still being read. */
function ProteinDots({ entries }: { entries: ClientDiaryEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="diary-dots" aria-label="Protein at each meal today">
      {entries.map((e) => (
        <span
          key={e.entry_id}
          className={"diary-dot " + (e.marks ? e.marks.protein : "pending")}
          title={e.marks ? PROTEIN_WORD[e.marks.protein] : "Not looked at yet"}
        />
      ))}
      <span className="diary-dots-label">Protein today</span>
    </div>
  );
}

function DiaryCard({ view }: { view: ClientDiaryView }) {
  const data = useOchre();
  const router = useRouter();
  const coachFirst = (data.coach?.name || "Your coach").split(" ")[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ClientDiaryEntry[]>(view.entries);
  const [doneDays, setDoneDays] = useState<Set<string>>(() => new Set(view.daysDone));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Marks arrive a few minutes after a photo (the AI reads it on the Mac).
  // They come from three places, newest last: the page load, the local copy of
  // a photo just added (none yet), and the poll below.
  const [live, setLive] = useState<Record<string, LiveFields>>({});
  const [liveTip, setLiveTip] = useState<ClientDiaryView["tip"]>(null);
  const pollsLeft = useRef(POLL_MAX);

  const doneToday = doneDays.has(view.today);
  const todays = useMemo(
    () =>
      entries
        .filter((e) => e.date === view.today)
        .sort((a, b) => a.time.localeCompare(b.time))
        // The poll is the newest word on marks / what it looks like / feedback.
        .map((e) => (live[e.entry_id] ? { ...e, ...live[e.entry_id] } : e)),
    [entries, view.today, live],
  );
  const waiting = todays.some((e) => !e.marks);

  // While a photo has no marks yet, ask for them about once a minute — only
  // while the app is on screen, and for at most POLL_MAX tries after the last
  // photo (an unreadable photo never gets marks; the coach names it). A small
  // read, not a page refresh: a refresh logs an app open each time.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || pollsLeft.current <= 0) return;
      pollsLeft.current -= 1;
      try {
        const res = await fetch(`/api/app-diary?token=${encodeURIComponent(data.token)}&view=1`, { cache: "no-store" });
        const j = (await res.json()) as { ok?: boolean; entries?: Record<string, LiveFields>; tip?: ClientDiaryView["tip"] };
        if (j.ok) {
          setLive(j.entries ?? {});
          if (j.tip) setLiveTip(j.tip);
        }
      } catch {
        /* offline for a moment — the next tick tries again */
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, data.token]);
  const tip = liveTip ?? view.tip;
  const photoUrl = (file: string) =>
    `/api/app-diary?token=${encodeURIComponent(data.token)}&file=${encodeURIComponent(file)}`;

  async function post(fields: Record<string, string | Blob>): Promise<Record<string, unknown> | null> {
    const fd = new FormData();
    fd.append("token", data.token);
    for (const [k, v] of Object.entries(fields)) {
      if (v instanceof Blob) fd.append(k, v, "photo.jpg");
      else fd.append(k, v);
    }
    try {
      const res = await fetch("/api/app-diary", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) {
        setError(typeof j.error === "string" ? j.error : "That didn't save — try again.");
        return null;
      }
      setError(null);
      return j;
    } catch {
      setError("Couldn't reach the app — check your connection.");
      return null;
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same photo be picked again after cancelling
    if (!file) return;
    setError(null);
    try {
      const blob = await shrinkPhoto(file);
      const time = nowHHMM();
      setDraft({ blob, preview: URL.createObjectURL(blob), band: bandOfTime(time), earlier: false, date: view.today, time, note: "" });
    } catch {
      setError("Couldn't read that photo — try another one.");
    }
  }

  function closeDraft() {
    if (draft) URL.revokeObjectURL(draft.preview);
    setDraft(null);
  }

  async function saveDraft() {
    if (!draft || busy) return;
    setBusy(true);
    const time = draft.earlier ? draft.time : nowHHMM();
    const date = draft.earlier ? draft.date : view.today;
    const j = await post({ action: "add", photo: draft.blob, date, time, band: draft.band, note: draft.note.trim() });
    setBusy(false);
    if (!j) return;
    setEntries((prev) => [...prev, j.entry as ClientDiaryEntry]);
    pollsLeft.current = POLL_MAX;
    setFlash(
      date !== view.today
        ? `Added to ${dayLabel(view, date)}.`
        : "Added — its marks show here in a few minutes.",
    );
    // A new photo after "done" re-opens the day — she is still eating.
    if (doneDays.has(date)) {
      const next = new Set(doneDays);
      next.delete(date);
      setDoneDays(next);
    }
    closeDraft();
  }

  async function markDone() {
    if (busy) return;
    setBusy(true);
    const j = await post({ action: "done", date: view.today });
    setBusy(false);
    if (j) setDoneDays(new Set(doneDays).add(view.today));
  }

  async function saveEntry(e: ClientDiaryEntry, patch: { note: string; band: DiaryBand; name: string }) {
    if (busy) return;
    const renamed = patch.name.trim() !== (e.looksLike ?? "").trim() && patch.name.trim() !== "";
    setBusy(true);
    const fields: Record<string, string> = { action: "edit", entry_id: e.entry_id, note: patch.note, band: patch.band };
    if (renamed) fields.name = patch.name.trim();
    const j = await post(fields);
    setBusy(false);
    if (!j) return;
    setEntries((prev) =>
      prev.map((x) =>
        x.entry_id !== e.entry_id
          ? x
          : renamed
            ? // Re-read with her words: the old marks described the misread
              // plate, so they go until the new read lands.
              { ...x, note: patch.note, band: patch.band, looksLike: patch.name.trim(), yours: true, marks: undefined, feedback: undefined }
            : { ...x, note: patch.note, band: patch.band },
      ),
    );
    if (renamed) {
      setLive((prev) => {
        const next = { ...prev };
        delete next[e.entry_id];
        return next;
      });
      pollsLeft.current = POLL_MAX;
      setFlash("Thanks — the marks update in a few minutes.");
    }
    setOpenEntry(null);
  }

  async function removeEntry(e: ClientDiaryEntry) {
    if (busy) return;
    setBusy(true);
    const j = await post({ action: "delete", entry_id: e.entry_id });
    setBusy(false);
    if (!j) return;
    setEntries((prev) => prev.filter((x) => x.entry_id !== e.entry_id));
    setOpenEntry(null);
  }

  // Today's photos — on the open card AND under "Done for today", so a
  // misread can still be corrected after the day is closed.
  const todayList =
    todays.length > 0 ? (
      <ul className="diary-list">
          {todays.map((e) => (
            <li key={e.entry_id}>
              <button className="diary-item" onClick={() => setOpenEntry(openEntry === e.entry_id ? null : e.entry_id)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the client's own photo, served token-scoped */}
                <img src={photoUrl(e.file)} alt="" className="diary-thumb" />
                <span className="diary-meta">
                  <span className="diary-band">
                    {DIARY_BAND_LABEL[e.band]} · {clock(e.time)}
                  </span>
                  {e.looksLike && (
                    <span className="diary-looks">
                      {e.yours ? e.looksLike : `Looks like ${e.looksLike}`}
                      {!e.yours && <span className="diary-fix"> · Not right?</span>}
                    </span>
                  )}
                  {e.marks && <Marks marks={e.marks} />}
                  {e.feedback && <span className="diary-feedback">{e.feedback}</span>}
                  {e.note && <span className="diary-note">{e.note}</span>}
                </span>
                <Icon name="pen" size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
              </button>
              {openEntry === e.entry_id && (
                <EntryEditor
                  entry={e}
                  busy={busy}
                  onSave={(patch) => saveEntry(e, patch)}
                  onDelete={() => removeEntry(e)}
                  onCancel={() => setOpenEntry(null)}
                />
              )}
            </li>
          ))}
        </ul>
    ) : null;

  // ── "Done for today" — the card folds to one line ──────────────────────
  if (doneToday && !draft) {
    return (
      <div className="diary diary-done" id="food-diary">
        <div className="diary-done-row">
          <span className="diary-glyph done">
            <Icon name="check" size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="diary-title">
              {view.isLastDay ? "Food diary done — thank you" : `Day ${view.dayNumber} done — thank you`}
            </div>
            <div className="diary-sub">
              {view.isLastDay
                ? `${coachFirst} will go through this with you.`
                : `Tomorrow is Day ${view.dayNumber + 1}.`}
            </div>
          </div>
          <button className="diary-link" onClick={() => fileRef.current?.click()}>
            Add more
          </button>
        </div>
        <ProteinDots entries={todays} />
        {flash && <p className="diary-flash">{flash}</p>}
        {error && <p className="diary-error">{error}</p>}
        {todayList}
        {view.isLastDay && tip && <TipLines tip={tip} />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>
    );
  }

  return (
    <div className="diary" id="food-diary">
      <div className="diary-head">
        <span className="diary-glyph">
          <Icon name="camera" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="diary-title">
            Food diary · Day {view.dayNumber} of {view.days}
          </div>
          <div className="diary-sub">Snap everything you eat and drink today.</div>
        </div>
      </div>
      <ProteinDots entries={todays} />
      {typeof view.gramsToday === "number" && (
        <p className="diary-sub" style={{ margin: "6px 2px 0" }}>
          About {view.gramsToday} g of protein today, from what you photographed.
        </p>
      )}

      {!draft && (
        <button className="diary-add" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="camera" size={20} />
          Add what you&apos;re eating
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />

      {draft && (
        <DraftEditor
          draft={draft}
          view={view}
          busy={busy}
          onChange={setDraft}
          onCancel={closeDraft}
          onSave={saveDraft}
        />
      )}

      {flash && <p className="diary-flash">{flash}</p>}
      {error && <p className="diary-error">{error}</p>}

      {todayList}

      {!draft && todays.length > 0 && (
        <button className="diary-donebtn" onClick={markDone} disabled={busy}>
          Done for today
        </button>
      )}

      <DiaryReminders onSaved={() => router.refresh()} />
    </div>
  );
}

function BandChips({ value, onPick }: { value: DiaryBand; onPick: (b: DiaryBand) => void }) {
  return (
    <div className="diary-chips" role="radiogroup" aria-label="Which meal">
      {DIARY_BANDS.map((b) => (
        <button
          key={b}
          role="radio"
          aria-checked={value === b}
          className={"diary-chip" + (value === b ? " on" : "")}
          onClick={() => onPick(b)}
        >
          {DIARY_BAND_LABEL[b]}
        </button>
      ))}
    </div>
  );
}

function DraftEditor({
  draft,
  view,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  view: ClientDiaryView;
  busy: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="diary-draft">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
      <img src={draft.preview} alt="Your photo" className="diary-preview" />
      <BandChips value={draft.band} onPick={(band) => onChange({ ...draft, band })} />
      <div className="diary-when">
        <button
          className={"diary-chip" + (!draft.earlier ? " on" : "")}
          onClick={() => onChange({ ...draft, earlier: false })}
        >
          Just now
        </button>
        <button
          className={"diary-chip" + (draft.earlier ? " on" : "")}
          onClick={() => onChange({ ...draft, earlier: true })}
        >
          Earlier
        </button>
      </div>
      {draft.earlier && (
        <div className="diary-earlier">
          {view.openDates.length > 1 && (
            <select
              value={draft.date}
              onChange={(e) => onChange({ ...draft, date: e.target.value })}
              aria-label="Which day"
            >
              {view.openDates.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(view, d)}
                </option>
              ))}
            </select>
          )}
          <input
            type="time"
            value={draft.time}
            aria-label="What time"
            onChange={(e) => {
              const time = e.target.value;
              onChange({ ...draft, time, band: time ? bandOfTime(time) : draft.band });
            }}
          />
        </div>
      )}
      <input
        className="diary-input"
        placeholder="Anything to add? e.g. homemade, half a bowl"
        maxLength={DIARY_NOTE_MAX}
        value={draft.note}
        onChange={(e) => onChange({ ...draft, note: e.target.value })}
      />
      <div className="diary-actions">
        <button className="diary-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="diary-save" onClick={onSave} disabled={busy || (draft.earlier && !draft.time)}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function EntryEditor({
  entry,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  entry: ClientDiaryEntry;
  busy: boolean;
  onSave: (patch: { note: string; band: DiaryBand; name: string }) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(entry.note);
  const [band, setBand] = useState<DiaryBand>(entry.band);
  const [name, setName] = useState(entry.looksLike ?? "");
  return (
    <div className="diary-draft">
      <label className="diary-label">
        What is it?
        <input
          className="diary-input"
          placeholder="e.g. spaghetti in tomato sauce"
          maxLength={DIARY_NAME_MAX}
          value={name}
          onChange={(ev) => setName(ev.target.value)}
        />
      </label>
      <BandChips value={band} onPick={setBand} />
      <input
        className="diary-input"
        placeholder="Anything to add? e.g. homemade, half a bowl"
        maxLength={DIARY_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="diary-actions">
        <button className="diary-ghost danger" onClick={onDelete} disabled={busy}>
          Remove photo
        </button>
        <span style={{ flex: 1 }} />
        <button className="diary-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="diary-save" onClick={() => onSave({ note: note.trim(), band, name })} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * The client's own reminder switch. OFF until she turns it on — the system
 * never reminds anyone about a diary on its own (decision 2026-10-23). Saved
 * through the same override store as every other app reminder, so the cron
 * that fires them needs nothing new.
 */
function DiaryReminders({ onSaved }: { onSaved: () => void }) {
  const data = useOchre();
  const ids = DIARY_REMINDERS.map((r) => r.id) as readonly string[];
  const mine = data.reminders.filter((r) => ids.includes(r.id));
  const [on, setOn] = useState(() => mine.some((r) => r.on));
  const [times, setTimes] = useState<Record<string, string>>(() =>
    Object.fromEntries(mine.map((r) => [r.id, r.time])),
  );
  const [custom, setCustom] = useState<Set<string>>(() => new Set(mine.filter((r) => r.timeCustom).map((r) => r.id)));
  if (mine.length === 0) return null;

  function persist(nextOn: boolean, nextTimes: Record<string, string>, nextCustom: Set<string>) {
    const items = data.reminders.map((r) =>
      ids.includes(r.id)
        ? { id: r.id, on: nextOn, time: nextTimes[r.id] ?? r.time, time_custom: nextCustom.has(r.id) }
        : { id: r.id, on: r.on, time: r.time, time_custom: r.timeCustom },
    );
    void fetch("/api/app-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: data.token, action: "save", items }),
    })
      .then(onSaved)
      .catch(() => {});
  }

  return (
    <div className="diary-remind">
      <label className="diary-remind-row">
        <span style={{ flex: 1 }}>Remind me at meal times</span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            persist(e.target.checked, times, custom);
          }}
        />
      </label>
      {on && (
        <div className="diary-remind-times">
          {mine.map((r) => (
            <label key={r.id}>
              <span>{r.label.replace(/^Food diary — add your /, "").replace(/^./, (c) => c.toUpperCase())}</span>
              <input
                type="time"
                value={times[r.id] ?? r.time}
                onChange={(e) => {
                  const nextTimes = { ...times, [r.id]: e.target.value };
                  const nextCustom = new Set(custom).add(r.id);
                  setTimes(nextTimes);
                  setCustom(nextCustom);
                  if (e.target.value) persist(on, nextTimes, nextCustom);
                }}
              />
            </label>
          ))}
          <p className="diary-sub" style={{ margin: "4px 0 0" }}>
            Reminders reach you only if notifications are on for this app.
          </p>
        </div>
      )}
    </div>
  );
}
