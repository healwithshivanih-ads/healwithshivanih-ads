"use client";

/**
 * THE FOOD DIARY in the new front: a photo of everything she eats for the few
 * days the coach chose (docs/FOOD_DIARY_PLAN.md). The server side is unchanged
 * from today's app: /api/app-diary stores the photos, the Mac's AI reads each
 * one, and clientDiaryView decides what the client may see.
 *
 * Three parts:
 *   - useSqDiary: the diary's state, held once in sq-app so the Home card and
 *     the sheet show the same photos;
 *   - SqDiaryCard: on Home while a diary runs. One big button opens the
 *     camera straight away; the photo then opens in the sheet to save;
 *   - SqDiarySheet: the new photo's details, today's photos with "Not
 *     right?", "Done for today" and her own meal-time reminders.
 *
 * What it deliberately does not do (the same rules as today's card):
 *   - show a number about food, unless the coach switched grams on;
 *   - reply to a photo or judge it;
 *   - remind her of anything she did not switch on herself.
 * The coach is "your coach", never by name (the new front's rule).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
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
import { shrinkPhoto } from "./photo-shrink";
import { SqIcon } from "./sq-ui";

const pad = (n: number) => String(n).padStart(2, "0");
type LiveFields = Pick<ClientDiaryEntry, "marks" | "looksLike" | "yours" | "feedback">;
type Tip = ClientDiaryView["tip"];
/** Ask for a photo's marks about once a minute, for up to ~20 minutes. */
const POLL_MS = 60_000;
const POLL_MAX = 20;

const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const bandOfTime = (t: string): DiaryBand => diaryBandForHour(parseInt(t.slice(0, 2), 10) || 0);

/** "13:05" → "1:05 pm" */
export function diaryClock(t: string): string {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${pad(m || 0)} ${h < 12 ? "am" : "pm"}`;
}

function dayLabel(view: ClientDiaryView, ymd: string): string {
  if (ymd === view.today) return "Today";
  const i = view.openDates.indexOf(ymd);
  return i >= 0 ? `Day ${i + 1}` : ymd;
}

export const PROTEIN_WORD = { present: "Protein ✓", light: "Light on protein", none: "No protein" } as const;
export const VEG_WORD = { present: "Veg ✓", light: "Light on veg", none: "No veg" } as const;

export type DiaryDraft = { blob: Blob; preview: string; band: DiaryBand; earlier: boolean; date: string; time: string; note: string };
export type DiaryPatch = { note: string; band: DiaryBand; name: string };

export function useSqDiary(data: ClientAppData, onPicked: () => void) {
  const view = data.foodDiary ?? null;
  const token = data.token;
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ClientDiaryEntry[]>(view?.entries ?? []);
  const [doneDays, setDoneDays] = useState<Set<string>>(() => new Set(view?.daysDone ?? []));
  const [draft, setDraft] = useState<DiaryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Marks arrive a few minutes after a photo (the AI reads it on the Mac).
  const [live, setLive] = useState<Record<string, LiveFields>>({});
  const [liveTip, setLiveTip] = useState<Tip>(null);
  const pollsLeft = useRef(POLL_MAX);

  const today = view?.today ?? "";
  const todays = useMemo(
    () =>
      entries
        .filter((e) => e.date === today)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((e) => (live[e.entry_id] ? { ...e, ...live[e.entry_id] } : e)),
    [entries, today, live],
  );
  const waiting = todays.some((e) => !e.marks);

  // While a photo has no marks yet, ask for them about once a minute, only
  // while the app is on screen, and at most POLL_MAX times after the last
  // photo (an unreadable photo never gets marks; the coach names it).
  useEffect(() => {
    if (!view || view.finished || !waiting) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || pollsLeft.current <= 0) return;
      pollsLeft.current -= 1;
      try {
        const res = await fetch(`/api/app-diary?token=${encodeURIComponent(token)}&view=1`, { cache: "no-store" });
        const j = (await res.json()) as { ok?: boolean; entries?: Record<string, LiveFields>; tip?: Tip };
        if (j.ok) {
          setLive(j.entries ?? {});
          if (j.tip) setLiveTip(j.tip);
        }
      } catch {
        /* offline for a moment; the next tick tries again */
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [view, waiting, token]);

  const photoUrl = (file: string) => `/api/app-diary?token=${encodeURIComponent(token)}&file=${encodeURIComponent(file)}`;

  async function post(fields: Record<string, string | Blob>): Promise<Record<string, unknown> | null> {
    const fd = new FormData();
    fd.append("token", token);
    for (const [k, v] of Object.entries(fields)) {
      if (v instanceof Blob) fd.append(k, v, "photo.jpg");
      else fd.append(k, v);
    }
    try {
      const res = await fetch("/api/app-diary", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) {
        setError(typeof j.error === "string" ? j.error : "That didn't save. Try again.");
        return null;
      }
      setError(null);
      return j;
    } catch {
      setError("Couldn't reach the app. Check your connection.");
      return null;
    }
  }

  /** Open the camera / photo picker. Call from a tap. */
  const pickPhoto = () => inputRef.current?.click();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same photo can be picked again after cancelling
    if (!file || !view) return;
    setError(null);
    setFlash(null);
    try {
      const blob = await shrinkPhoto(file);
      const time = nowHHMM();
      if (draft) URL.revokeObjectURL(draft.preview);
      setDraft({ blob, preview: URL.createObjectURL(blob), band: bandOfTime(time), earlier: false, date: view.today, time, note: "" });
      onPicked();
    } catch {
      setError("Couldn't read that photo. Try another one.");
      onPicked();
    }
  }

  function closeDraft() {
    if (draft) URL.revokeObjectURL(draft.preview);
    setDraft(null);
  }

  async function saveDraft() {
    if (!draft || busy || !view) return;
    setBusy(true);
    const time = draft.earlier ? draft.time : nowHHMM();
    const date = draft.earlier ? draft.date : view.today;
    const j = await post({ action: "add", photo: draft.blob, date, time, band: draft.band, note: draft.note.trim() });
    setBusy(false);
    if (!j) return;
    setEntries((prev) => [...prev, j.entry as ClientDiaryEntry]);
    pollsLeft.current = POLL_MAX;
    setFlash(date !== view.today ? `Added to ${dayLabel(view, date)}.` : "Added. Its marks show here in a few minutes.");
    // A new photo after "done" opens the day again: she is still eating.
    if (doneDays.has(date)) {
      const next = new Set(doneDays);
      next.delete(date);
      setDoneDays(next);
    }
    closeDraft();
  }

  async function markDone() {
    if (busy || !view) return;
    setBusy(true);
    const j = await post({ action: "done", date: view.today });
    setBusy(false);
    if (j) setDoneDays(new Set(doneDays).add(view.today));
  }

  async function saveEntry(e: ClientDiaryEntry, patch: DiaryPatch): Promise<boolean> {
    if (busy) return false;
    const renamed = patch.name.trim() !== "" && patch.name.trim() !== (e.looksLike ?? "").trim();
    setBusy(true);
    const fields: Record<string, string> = { action: "edit", entry_id: e.entry_id, note: patch.note, band: patch.band };
    if (renamed) fields.name = patch.name.trim();
    const j = await post(fields);
    setBusy(false);
    if (!j) return false;
    setEntries((prev) =>
      prev.map((x) =>
        x.entry_id !== e.entry_id
          ? x
          : renamed
            ? // Read again with her words: the old marks described the misread plate.
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
      setFlash("Thanks. The marks update in a few minutes.");
    }
    return true;
  }

  async function removeEntry(e: ClientDiaryEntry): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    const j = await post({ action: "delete", entry_id: e.entry_id });
    setBusy(false);
    if (!j) return false;
    setEntries((prev) => prev.filter((x) => x.entry_id !== e.entry_id));
    return true;
  }

  const input = <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />;

  return {
    view,
    todays,
    tip: liveTip ?? view?.tip ?? null,
    doneToday: !!view && doneDays.has(view.today),
    draft,
    setDraft,
    busy,
    error,
    flash,
    photoUrl,
    pickPhoto,
    input,
    closeDraft,
    saveDraft,
    markDone,
    saveEntry,
    removeEntry,
  };
}
export type SqDiaryState = ReturnType<typeof useSqDiary>;

// ── pieces ───────────────────────────────────────────────────────────────────

function Marks({ marks }: { marks: NonNullable<ClientDiaryEntry["marks"]> }) {
  return (
    <span className="sq-dmarks">
      <span className={"sq-dmark sq-p-" + marks.protein}>{PROTEIN_WORD[marks.protein]}</span>
      {marks.veg && <span className={"sq-dmark sq-v-" + marks.veg}>{VEG_WORD[marks.veg]}</span>}
      {marks.carbs === "heavy" && <span className="sq-dmark sq-carb">Carb-heavy</span>}
    </span>
  );
}

/** One dot per photo today: full for protein, half for a little, open for
 *  none, dashed while it is still being read. */
function ProteinDots({ entries }: { entries: ClientDiaryEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="sq-ddots" aria-label="Protein at each meal today">
      {entries.map((e) => (
        <span key={e.entry_id} className={"sq-ddot sq-" + (e.marks ? e.marks.protein : "pending")} title={e.marks ? PROTEIN_WORD[e.marks.protein] : "Not looked at yet"} />
      ))}
      <span className="sq-ddots-l">Protein today</span>
    </div>
  );
}

function TipLines({ tip }: { tip: NonNullable<Tip> }) {
  return (
    <div className="sq-dtip">
      <p>
        <b>Going well:</b> {tip.strength}
      </p>
      {tip.fix && (
        <p>
          <b>One thing to try:</b> {tip.fix}
        </p>
      )}
    </div>
  );
}

// ── Home card ────────────────────────────────────────────────────────────────

export function SqDiaryCard({ d, onOpen }: { d: SqDiaryState; onOpen: () => void }) {
  const view = d.view;
  if (!view) return null;
  if (view.finished) {
    return (
      <section className="sq-card sq-diary">
        <div className="sq-eyebrow">Food diary</div>
        <h3>Food diary done. Thank you.</h3>
        <p className="sq-sub">Your coach will go through it with you.</p>
        {d.tip && <TipLines tip={d.tip} />}
      </section>
    );
  }
  const n = d.todays.length;
  if (d.doneToday) {
    return (
      <section className="sq-card sq-diary">
        <div className="sq-eyebrow">
          Food diary · Day {view.dayNumber} of {view.days}
        </div>
        <h3>{view.isLastDay ? "Food diary done. Thank you." : `Day ${view.dayNumber} done. Thank you.`}</h3>
        <p className="sq-sub">{view.isLastDay ? "Your coach will go through it with you." : `Tomorrow is Day ${view.dayNumber + 1}.`}</p>
        <ProteinDots entries={d.todays} />
        <div className="sq-drow">
          <button type="button" className="sq-link" onClick={onOpen}>
            Today&rsquo;s photos ({n})
          </button>
          <button type="button" className="sq-link" onClick={d.pickPhoto}>
            Add more
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="sq-card sq-diary">
      <div className="sq-eyebrow">
        Food diary · Day {view.dayNumber} of {view.days}
      </div>
      <h3>Snap everything you eat and drink today.</h3>
      <ProteinDots entries={d.todays} />
      <button type="button" className="sq-btn sq-btn-solid sq-dadd" onClick={d.pickPhoto} disabled={d.busy}>
        <SqIcon name="camera" /> Add a photo
      </button>
      {d.error && !d.draft && <p className="sq-derr">{d.error}</p>}
      {n > 0 && (
        <button type="button" className="sq-link" onClick={onOpen}>
          Today&rsquo;s photos ({n}) · Done for today
        </button>
      )}
    </section>
  );
}

// ── the sheet ────────────────────────────────────────────────────────────────

function BandChips({ value, onPick }: { value: DiaryBand; onPick: (b: DiaryBand) => void }) {
  return (
    <div className="sq-dchips" role="radiogroup" aria-label="Which meal">
      {DIARY_BANDS.map((b) => (
        <button key={b} type="button" role="radio" aria-checked={value === b} className="sq-pchip" onClick={() => onPick(b)}>
          {DIARY_BAND_LABEL[b]}
        </button>
      ))}
    </div>
  );
}

function DraftEditor({ d }: { d: SqDiaryState }) {
  const draft = d.draft!;
  const view = d.view!;
  const set = (patch: Partial<DiaryDraft>) => d.setDraft({ ...draft, ...patch });
  return (
    <section className="sq-card sq-ddraft">
      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of her own photo */}
      <img src={draft.preview} alt="Your photo" className="sq-dprev" />
      <div className="sq-sec">Which meal</div>
      <BandChips value={draft.band} onPick={(band) => set({ band })} />
      <div className="sq-sec">When</div>
      <div className="sq-dchips">
        <button type="button" className="sq-pchip" aria-pressed={!draft.earlier} onClick={() => set({ earlier: false })}>
          Just now
        </button>
        <button type="button" className="sq-pchip" aria-pressed={draft.earlier} onClick={() => set({ earlier: true })}>
          Earlier
        </button>
      </div>
      {draft.earlier && (
        <div className="sq-dchips">
          {view.openDates.length > 1 && (
            <select className="sq-dinput" value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-label="Which day">
              {view.openDates.map((x) => (
                <option key={x} value={x}>
                  {dayLabel(view, x)}
                </option>
              ))}
            </select>
          )}
          <input
            className="sq-dinput"
            type="time"
            value={draft.time}
            aria-label="What time"
            onChange={(e) => set({ time: e.target.value, band: e.target.value ? bandOfTime(e.target.value) : draft.band })}
          />
        </div>
      )}
      <input
        className="sq-dinput"
        placeholder="Anything to add? e.g. homemade, half a bowl"
        maxLength={DIARY_NOTE_MAX}
        value={draft.note}
        onChange={(e) => set({ note: e.target.value })}
      />
      <div className="sq-prow">
        <button type="button" className="sq-btn sq-btn-quiet" onClick={d.closeDraft} disabled={d.busy}>
          Cancel
        </button>
        <button type="button" className="sq-btn sq-btn-solid" onClick={d.saveDraft} disabled={d.busy || (draft.earlier && !draft.time)}>
          {d.busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function EntryEditor({ d, e, onClose }: { d: SqDiaryState; e: ClientDiaryEntry; onClose: () => void }) {
  const [note, setNote] = useState(e.note);
  const [band, setBand] = useState<DiaryBand>(e.band);
  const [name, setName] = useState(e.looksLike ?? "");
  return (
    <div className="sq-dedit">
      <label className="sq-sec" htmlFor={`dn-${e.entry_id}`}>
        What is it?
      </label>
      <input id={`dn-${e.entry_id}`} className="sq-dinput" placeholder="e.g. dal, rice and beans sabzi" maxLength={DIARY_NAME_MAX} value={name} onChange={(ev) => setName(ev.target.value)} />
      <BandChips value={band} onPick={setBand} />
      <input className="sq-dinput" placeholder="Anything to add? e.g. homemade, half a bowl" maxLength={DIARY_NOTE_MAX} value={note} onChange={(ev) => setNote(ev.target.value)} />
      <div className="sq-prow">
        <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={async () => (await d.removeEntry(e)) && onClose()} disabled={d.busy}>
          Remove photo
        </button>
        <button type="button" className="sq-btn sq-btn-quiet sq-btn-small" onClick={onClose} disabled={d.busy}>
          Cancel
        </button>
        <button type="button" className="sq-btn sq-btn-solid sq-btn-small" onClick={async () => (await d.saveEntry(e, { note: note.trim(), band, name })) && onClose()} disabled={d.busy}>
          Save
        </button>
      </div>
    </div>
  );
}

export function SqDiarySheet({ d, data }: { d: SqDiaryState; data: ClientAppData }) {
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const view = d.view;
  if (!view) return <p className="sq-sub">There is no food diary running now.</p>;
  return (
    <>
      {d.draft && <DraftEditor d={d} />}
      {d.flash && <p className="sq-soft">{d.flash}</p>}
      {d.error && <p className="sq-derr">{d.error}</p>}

      {!d.draft && !view.finished && (
        <button type="button" className="sq-btn sq-btn-solid sq-dadd" onClick={d.pickPhoto} disabled={d.busy}>
          <SqIcon name="camera" /> Add a photo
        </button>
      )}

      {typeof view.gramsToday === "number" && <p className="sq-sub">About {view.gramsToday} g of protein today, from what you photographed.</p>}

      {d.todays.length > 0 && (
        <section className="sq-card">
          <div className="sq-sec">Today</div>
          <ProteinDots entries={d.todays} />
          <ul className="sq-dlist">
            {d.todays.map((e) => (
              <li key={e.entry_id}>
                <button type="button" className="sq-ditem" aria-expanded={openEntry === e.entry_id} onClick={() => setOpenEntry(openEntry === e.entry_id ? null : e.entry_id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- her own photo, served token-scoped */}
                  <img src={d.photoUrl(e.file)} alt="" className="sq-dthumb" />
                  <span className="sq-dmeta">
                    <small>
                      {DIARY_BAND_LABEL[e.band]} · {diaryClock(e.time)}
                    </small>
                    {e.looksLike ? (
                      <b>
                        {e.yours ? e.looksLike : `Looks like ${e.looksLike}`}
                        {!e.yours && <span className="sq-dfix"> · Not right?</span>}
                      </b>
                    ) : (
                      !e.marks && <b className="sq-dwait">Being looked at…</b>
                    )}
                    {e.marks && <Marks marks={e.marks} />}
                    {e.feedback && <span className="sq-dfeed">{e.feedback}</span>}
                    {e.note && <span className="sq-dnote">{e.note}</span>}
                  </span>
                  <SqIcon name="pen" />
                </button>
                {openEntry === e.entry_id && <EntryEditor key={e.entry_id} d={d} e={e} onClose={() => setOpenEntry(null)} />}
              </li>
            ))}
          </ul>
          {!d.draft && !d.doneToday && !view.finished && (
            <button type="button" className="sq-btn sq-btn-quiet" onClick={d.markDone} disabled={d.busy}>
              Done for today
            </button>
          )}
          {d.doneToday && <p className="sq-sub">{view.isLastDay ? "Food diary done. Thank you. Your coach will go through it with you." : `Day ${view.dayNumber} done. Thank you.`}</p>}
        </section>
      )}

      {(view.finished || (d.doneToday && view.isLastDay)) && d.tip && (
        <section className="sq-card">
          <TipLines tip={d.tip} />
        </section>
      )}

      {!view.finished && <DiaryReminders data={data} />}
    </>
  );
}

/**
 * Her own meal-time reminders. Off until she turns them on: nothing reminds
 * anyone about a diary on its own (decision 2026-10-23). Saved through the
 * same store as every other app reminder.
 */
function DiaryReminders({ data }: { data: ClientAppData }) {
  const ids = DIARY_REMINDERS.map((r) => r.id) as readonly string[];
  const mine = data.reminders.filter((r) => ids.includes(r.id));
  const [on, setOn] = useState(() => mine.some((r) => r.on));
  const [times, setTimes] = useState<Record<string, string>>(() => Object.fromEntries(mine.map((r) => [r.id, r.time])));
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
    }).catch(() => {});
  }

  return (
    <section className="sq-card">
      <button
        type="button"
        className="sq-li"
        role="switch"
        aria-checked={on}
        onClick={() => {
          setOn(!on);
          persist(!on, times, custom);
        }}
      >
        <span className="sq-li-body">
          <b>Remind me at meal times</b>
          <small>{on ? "On. Reminders reach you if notifications are on for this app." : "Off"}</small>
        </span>
        <span className="sq-switch" aria-hidden="true" />
      </button>
      {on && (
        <div className="sq-dtimes">
          {mine.map((r) => (
            <label key={r.id}>
              <span>{r.label.replace(/^Food diary — add your /, "").replace(/^./, (c) => c.toUpperCase())}</span>
              <input
                className="sq-dinput"
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
        </div>
      )}
    </section>
  );
}
