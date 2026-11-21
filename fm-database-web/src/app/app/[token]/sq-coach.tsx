"use client";

/**
 * The Coach tab: the message thread with the coach.
 *
 * Same engine as today's app — /api/app-chat, the same stored thread, the
 * same notification to the coach — with a new front. Two things are added:
 *   - every message typed here passes the ask box's safety list. It is STILL
 *     SENT; the emergency card or the "see a doctor today" line shows beside it.
 *   - a message that could not be sent stays on screen marked "Not sent yet",
 *     with its words kept, instead of vanishing.
 *
 * Not here yet: sending a photo, and turning on notifications (today's app
 * has both; they come with the polish step).
 *
 * Copy rule: "your coach", never the coach's name.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { urgentCard } from "@/lib/fmdb/ask-card";
import { coachTabNote } from "@/lib/fmdb/ask-safety";

export interface CoachMsg {
  id: string;
  at: string;
  from: "me" | "coach";
  text: string;
  /** only on a message still on this phone: going, or not gone */
  state?: "sending" | "failed";
}

export type CoachNote = ReturnType<typeof coachTabNote>;

export interface CoachThread {
  msgs: CoachMsg[];
  /** messages typed here that have not reached the server (yet) */
  local: CoachMsg[];
  loaded: boolean;
  /** true when the coach has written and she has not opened the tab since */
  unread: boolean;
  note: CoachNote;
  /** Send a message. `keep` leaves a failed one in the thread as "Not sent
   *  yet"; the ask box's hand-off passes false and shows the failure itself. */
  send: (text: string, keep?: boolean) => Promise<boolean>;
  retry: (id: string) => void;
}

const unsentKey = (token: string) => `sq.coach.unsent.${token}`;

function readUnsent(token: string): CoachMsg[] {
  try {
    const raw = localStorage.getItem(unsentKey(token));
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((m): m is CoachMsg => !!m && typeof m === "object" && typeof m.id === "string" && typeof m.text === "string")
      .map((m) => ({ ...m, from: "me" as const, state: "failed" as const }));
  } catch {
    return [];
  }
}

function writeUnsent(token: string, list: CoachMsg[]): void {
  try {
    if (list.length) localStorage.setItem(unsentKey(token), JSON.stringify(list));
    else localStorage.removeItem(unsentKey(token));
  } catch {
    /* private mode: the message still shows until the app is closed */
  }
}

/**
 * The thread's state. Lives in the shell so the dot on the Coach tab works
 * from any tab and a hand-off from the ask box can send without opening it.
 * `open` is true while the Coach tab is on screen.
 */
export function useCoachThread(token: string, open: boolean): CoachThread {
  const [msgs, setMsgs] = useState<CoachMsg[]>([]);
  const [local, setLocal] = useState<CoachMsg[]>([]);
  // A message that did not send is kept on the phone too, so closing or
  // reloading the app never loses her words. Restored once, after mount (the
  // page is drawn on the server first, where there is no storage).
  const restored = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const saved = readUnsent(token);
      restored.current = true;
      if (saved.length) setLocal((l) => [...saved.filter((m) => !l.some((x) => x.id === m.id)), ...l]);
    }, 0);
    return () => clearTimeout(t);
  }, [token]);
  useEffect(() => {
    // Only failed ones: one still "sending" may have reached the coach, and
    // keeping it would risk sending it twice.
    if (restored.current) writeUnsent(token, local.filter((m) => m.state === "failed"));
  }, [token, local]);
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(false);
  const [note, setNote] = useState<CoachNote>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/app-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...body }),
      });
      return (await res.json()) as { ok?: boolean; messages?: CoachMsg[]; unread?: number; error?: string };
    },
    [token],
  );

  // Reading the list also marks the coach's messages as read, so it is done
  // only while the tab is open — never to feed the dot.
  const load = useCallback(async () => {
    try {
      const j = await post({ action: "list" });
      if (j.ok) {
        setMsgs(j.messages ?? []);
        setUnread(false);
      }
    } catch {
      /* offline: keep what is on screen */
    } finally {
      setLoaded(true);
    }
  }, [post]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [open, load]);

  // The dot: asked when the app opens and when she comes back to it. No timer.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if (openRef.current) return void load();
      try {
        const j = await post({ action: "unread" });
        if (j.ok) setUnread((j.unread ?? 0) > 0);
      } catch {
        /* offline */
      }
    };
    const t = setTimeout(() => void check(), 0);
    const onShow = () => void check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [post, load]);

  const send = useCallback(
    async (text: string, keep = true): Promise<boolean> => {
      const body = text.trim();
      if (!body) return false;
      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (keep) {
        setNote(coachTabNote(body));
        setLocal((l) => [...l, { id, at: new Date().toISOString(), from: "me", text: body, state: "sending" }]);
      }
      try {
        const j = await post({ action: "send", text: body });
        if (!j.ok) throw new Error(j.error || "not sent");
        setLocal((l) => l.filter((m) => m.id !== id));
        if (openRef.current) await load();
        return true;
      } catch {
        setLocal((l) => l.map((m) => (m.id === id ? { ...m, state: "failed" as const } : m)));
        return false;
      }
    },
    [post, load],
  );

  const retry = useCallback(
    (id: string) => {
      const m = local.find((x) => x.id === id);
      if (!m) return;
      setLocal((l) => l.filter((x) => x.id !== id));
      void send(m.text);
    },
    [local, send],
  );

  return { msgs, local, loaded, unread, note, send, retry };
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${time}`;
}

export function SqCoach({ data, thread }: { data: ClientAppData; thread: CoachThread }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const count = thread.msgs.length + thread.local.length;
  const hasNote = !!thread.note;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count, hasNote]);

  const lastMine = [...thread.msgs].reverse().find((m) => m.from === "me")?.id;
  const note = thread.note;
  const urgent = note && "urgent" in note ? urgentCard(note.urgent) : null;

  return (
    <div className="sq-coachv">
      <div className="sq-coach-h">
        <span className="sq-av" aria-hidden="true">
          C
        </span>
        <div>
          <b>Your coach</b>
          <span>Functional medicine coaching</span>
        </div>
      </div>
      <section className="sq-soft">
        Your coach reads every message and replies within 24 hours. If something feels urgent, see a doctor.
      </section>
      {data.coach.nextSession && <section className="sq-soft">Next session · {data.coach.nextSession}</section>}

      {!thread.loaded ? (
        <p className="sq-sub" role="status">
          Loading your messages…
        </p>
      ) : count === 0 ? (
        <p className="sq-sub">No messages yet. Write to your coach below.</p>
      ) : null}

      <div className="sq-thread" role="log" aria-label="Messages with your coach">
        {thread.msgs.map((m) =>
          m.from === "me" ? (
            <div key={m.id} className="sq-me">
              {m.text}
              <small>
                Sent · {when(m.at)}
                {m.id === lastMine ? " · reply within 24 hours" : ""}
              </small>
            </div>
          ) : (
            <div key={m.id} className="sq-them">
              {m.text}
              <small>{when(m.at)}</small>
            </div>
          ),
        )}
        {thread.local.map((m) => (
          <div key={m.id} className={"sq-me" + (m.state === "failed" ? " sq-me-failed" : "")}>
            {m.text}
            {m.state === "failed" ? (
              <small>
                Not sent yet ·{" "}
                <button type="button" className="sq-link" onClick={() => thread.retry(m.id)}>
                  Try again
                </button>
              </small>
            ) : (
              <small>Sending…</small>
            )}
          </div>
        ))}
      </div>

      {/* Beside the message, never instead of it: the message has gone to the coach. */}
      {urgent && (
        <section className="sq-card sq-ans sq-urgent" role="alert">
          <div className="sq-src">{urgent.src}</div>
          <h3>{urgent.heading}</h3>
          {urgent.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </section>
      )}
      {note && "doctor" in note && (
        <p className="sq-note sq-doctor" role="status">
          {note.doctor} Your coach replies within 24 hours.
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}
