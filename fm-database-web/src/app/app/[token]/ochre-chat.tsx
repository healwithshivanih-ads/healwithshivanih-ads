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

type Msg = {
  id: string;
  at: string;
  from: "me" | "coach";
  text: string;
  via: string;
  kind?: string;
  file?: string;
  /** Present on the client's own in-app messages: has it reached her phone? */
  delivered?: boolean;
};

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
  const [pushNote, setPushNote] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);

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
      const ok = res.ok && j.ok;
      setPushState(ok ? "on" : "off");
      // A test lands on this device now, so "it doesn't work" is answered
      // here rather than days later by a missed reply.
      if (ok) setPushNote(j.verified ? "Sent you a test notification just now — it should be on your screen. If nothing appeared, your phone is holding it back: open Settings → Apps → Chrome → Notifications and allow them, then check Battery isn't set to Restricted for Chrome." : "Turned on — but the test notification didn't go through. Try again in a moment.");
    } catch {
      setPushState("off");
    }
  }

  /**
   * Shrink on the phone before uploading.
   *
   * A modern phone camera produces 3–6 MB per shot. On Indian mobile data
   * that is a slow upload the client watches fail, and it is the single
   * biggest lever on what this feature costs to run — roughly ten times.
   * Canvas re-encoding also drops EXIF, so the GPS coordinates of someone's
   * kitchen never leave their phone. The server strips it again; neither
   * side trusts the other to have done it.
   */
  async function shrink(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.8),
    );
    // If the browser refuses to encode, send the original rather than
    // nothing — the server will shrink it anyway.
    return blob ?? file;
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let them re-pick the same photo after cancelling
    if (!file) return;
    setError(null);
    try {
      const blob = await shrink(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      setError("Couldn't read that photo — try another one.");
    }
  }

  async function sendPhoto() {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("token", c.token);
    fd.append("photo", photo.blob, "photo.jpg");
    if (draft.trim()) fd.append("text", draft.trim());
    try {
      const res = await fetch("/api/chat-photo", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error ?? "Couldn't send that photo.");
      } else {
        URL.revokeObjectURL(photo.preview);
        setPhoto(null);
        setDraft("");
        await load();
      }
    } catch {
      setError("Couldn't send — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (photo) return void sendPhoto();
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
              <div className="chat-bubble">
                {m.kind === "photo" && m.file ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- served
                     from a token-scoped API route, not a static path the
                     optimiser can reach. */
                  <img
                    className="chat-photo"
                    src={`/api/chat-media?token=${encodeURIComponent(c.token)}&file=${encodeURIComponent(m.file)}`}
                    alt={m.text || "Photo you sent"}
                    loading="lazy"
                  />
                ) : null}
                {m.text ? <span>{m.text}</span> : null}
              </div>
              <div className="chat-meta">
                {when(m.at)}
                {m.from === "me" && m.via === "app"
                  ? m.delivered
                    ? " · Delivered"
                    : " · Sent"
                  : ""}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="chat-error">{error}</p>}

      {photo && (
        <div className="chat-attach">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local
              object URL; there is nothing for the optimiser to fetch. */}
          <img src={photo.preview} alt="Photo to send" />
          <div className="chat-attach-txt">Ready to send — add a note if you like.</div>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => {
              URL.revokeObjectURL(photo.preview);
              setPhoto(null);
            }}
          >
            ✕
          </button>
        </div>
      )}

      <form className="chat-compose" onSubmit={send}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={pick}
        />
        <button
          type="button"
          className="chat-clip"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a photo"
        >
          <Icon name="camera" size={19} />
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={`Message ${firstName}`}
          aria-label={`Message ${firstName}`}
        />
        <button type="submit" disabled={busy || (!draft.trim() && !photo)} aria-label="Send">
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
      {pushNote && <p className="chat-note">{pushNote}</p>}
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
