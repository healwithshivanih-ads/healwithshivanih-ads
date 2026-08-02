"use client";

/**
 * Messages — the client's side of the conversation with their coach.
 *
 * Replaces WhatsApp as the default channel (WhatsApp becomes paid per message
 * from October) while WhatsApp history stays merged in, so the thread does not
 * appear to start on the day we switched. The WhatsApp button stays below as a
 * second option; nobody is forced across.
 *
 * TWO THINGS CARRY MORE WEIGHT THAN THE UI HERE:
 *
 * 1. NOTIFICATIONS. A reply the client never sees is worse than no chat at
 *    all — they conclude their coach ignored them. So the permission ask
 *    lives HERE, at the only moment it makes sense: right after they send
 *    something and are waiting for an answer. A generic "enable
 *    notifications?" on first launch converted 2 of 14; "get a nudge when
 *    Shivani replies" is a reason, not a request.
 *
 * 2. IT IS NOT A CHANNEL TO EMERGENCIES. WhatsApp at least felt
 *    instantaneous. A message typed at 2am may wait until morning, so the
 *    screen says the reply time plainly, and an acute cue gets an immediate
 *    answer telling them to call for help rather than a queued message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, useOchre } from "./ochre-context";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/fmdb/push-public";
import { isEmergency } from "@/lib/fmdb/triage";

type Msg = { id: string; at: string; from: "me" | "coach"; text: string; via: string };

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${time}`;
}

export function OchreChat({ firstName }: { firstName: string }) {
  const c = useOchre() as unknown as { token: string };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "asking" | "blocked">("unknown");
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/app-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: c.token, action: "list" }),
      });
      const j = await res.json();
      if (j.ok) setMsgs(j.messages ?? []);
    } catch {
      // Offline: keep whatever is already on screen rather than blanking it.
    } finally {
      setLoaded(true);
    }
  }, [c.token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof Notification === "undefined") return setPushState("off");
    if (Notification.permission === "granted") setPushState("on");
    else if (Notification.permission === "denied") setPushState("blocked");
    else setPushState("off");
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  async function enableNudges() {
    setPushState("asking");
    try {
      const reg = await navigator.serviceWorker.register("/ochre-app/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setPushState("blocked");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const res = await fetch("/api/app-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: c.token, action: "subscribe", subscription: sub.toJSON() }),
      });
      const j = await res.json().catch(() => ({}));
      setPushState(res.ok && j.ok ? "on" : "off");
    } catch {
      setPushState("off");
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    // Checked here for instant feedback AND server-side on the route, so a
    // direct POST cannot skip it.
    setEmergency(isEmergency(text));
    setBusy(true);
    const pending: Msg = {
      id: `pending-${Date.now()}`,
      at: new Date().toISOString(),
      from: "me",
      text,
      via: "app",
    };
    setMsgs((m) => [...m, pending]);
    try {
      const res = await fetch("/api/app-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: c.token, action: "send", text }),
      });
      const j = await res.json();
      if (!j.ok) {
        setMsgs((m) => m.filter((x) => x.id !== pending.id));
        setDraft(text);
        setError(j.error ?? "Couldn't send.");
      } else {
        if (j.emergency) setEmergency(true);
        await load();
      }
    } catch {
      setMsgs((m) => m.filter((x) => x.id !== pending.id));
      setDraft(text);
      setError("Couldn't send — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const sentSomething = msgs.some((m) => m.from === "me");

  return (
    <div className="ochre-chat">
      {emergency && (
        <div className="chat-emergency" role="alert">
          <strong>If this is urgent, don&apos;t wait for a reply.</strong>
          <p>
            Call your doctor or your local emergency number now. {firstName} may not
            see this message for some hours.
          </p>
        </div>
      )}

      <div className="chat-log">
        {!loaded ? (
          <p className="chat-empty">Loading your messages…</p>
        ) : msgs.length === 0 ? (
          <p className="chat-empty">
            No messages yet. Anything you write here goes straight to {firstName}.
          </p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`chat-row ${m.from === "me" ? "mine" : "theirs"}`}>
              <div className="chat-bubble">{m.text}</div>
              <div className="chat-meta">{when(m.at)}</div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="chat-error">{error}</p>}

      <form className="chat-compose" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={`Message ${firstName}`}
          aria-label={`Message ${firstName}`}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>

      <p className="chat-note">
        {firstName} usually replies within a day. Not for emergencies.
      </p>

      {/* The ask, at the only moment it earns an answer: they have just sent
          something and are waiting. */}
      {sentSomething && pushState === "off" && (
        <div className="chat-nudge">
          <div>
            <strong>Want to know when {firstName} replies?</strong>
            <p>We&apos;ll send one notification — nothing else.</p>
          </div>
          <button type="button" onClick={enableNudges}>
            Turn on
          </button>
        </div>
      )}
      {pushState === "asking" && <p className="chat-note">Asking your phone…</p>}
      {pushState === "blocked" && sentSomething && (
        <p className="chat-note">
          Notifications are blocked in your phone&apos;s settings. Allow them for
          this app and they&apos;ll start working.
        </p>
      )}
    </div>
  );
}
