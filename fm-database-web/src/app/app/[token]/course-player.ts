"use client";

/**
 * The long-audio player for courses (Calm Gut): one HTMLAudioElement for the
 * whole app, so a session keeps playing while the listener moves between
 * tabs, and on the lock screen.
 *
 *  - Media Session: title + artwork on the lock screen, play / pause /
 *    ±15 s / scrub from there.
 *  - Resume: the position is kept per track + version on this phone and the
 *    next play starts from it (rewound 5 s so the voice picks up gently).
 *  - "Listened": the seconds actually PLAYED (not skipped over) reach 80% of
 *    the track → one POST to the server, which ticks "I listened today".
 *  - Links: short-lived. A link that died mid-pause is fetched again and
 *    playback resumes where it was.
 *  - Offline: a saved copy (course-offline.ts) plays from the phone first.
 *  - Intros: the first time a week's session is played, its 2-minute intro
 *    (the reading, voiced) plays first and flows straight into the session;
 *    "Skip intro" jumps ahead at any point. An intro keeps no position and
 *    never counts as a listen — those belong to the session.
 *
 * Existing app audio (sq-sound.ts, ochre-breath-audio.ts) is short clips via
 * Web Audio; nothing here touches it.
 */

import { offlineBlobUrl } from "./course-offline";

export type CourseVersion = "music" | "voice";

export interface PlayerTrack {
  courseSlug: string;
  id: string;
  title: string;
  subtitle: string;
  rev: string;
  /** "intro" tracks keep no resume position and never count as a listen. */
  kind?: string;
}

export interface PlayerState {
  track: PlayerTrack | null;
  version: CourseVersion;
  playing: boolean;
  loading: boolean;
  current: number;
  duration: number;
  error: string | null;
  /** True once this play counted as a listen (≥ 80%). */
  counted: boolean;
  /** While an intro plays ahead of a session: that session (it starts when
   *  the intro ends or is skipped). */
  introFor: PlayerTrack | null;
}

const LISTEN_FRACTION = 0.8;

let audio: HTMLAudioElement | null = null;
let token = "";
let clientKey = "";
let objectUrl: string | null = null;
let state: PlayerState = {
  track: null,
  version: "music",
  playing: false,
  loading: false,
  current: 0,
  duration: 0,
  error: null,
  counted: false,
  introFor: null,
};
let pendingSession: { track: PlayerTrack; version: CourseVersion } | null = null;
const listeners = new Set<() => void>();
let lastTick: number | null = null;
let playedSec = 0;
let lastSaved = 0;
let retriedLink = false;
let onListened: ((trackId: string) => void) | null = null;

function emit(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribePlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getPlayerState(): PlayerState {
  return state;
}

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}
function posKey(t: PlayerTrack, v: CourseVersion) {
  return `ochre.course.pos.${clientKey}.${t.courseSlug}.${t.id}.${v}`;
}
function playedKey(t: PlayerTrack, v: CourseVersion) {
  // Per day: listening to half today and half tomorrow is two half-listens.
  return `ochre.course.played.${clientKey}.${t.courseSlug}.${t.id}.${v}.${todayLocal()}`;
}
function countedKey(t: PlayerTrack) {
  return `ochre.course.counted.${clientKey}.${t.courseSlug}.${t.id}.${todayLocal()}`;
}
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

/** Version preference (music / voice only), per phone. */
export function preferredVersion(): CourseVersion {
  return lsGet("ochre.course.version") === "voice" ? "voice" : "music";
}
export function setPreferredVersion(v: CourseVersion) {
  lsSet("ochre.course.version", v);
}

/** Saved resume position in seconds (0 if none). */
export function savedPosition(t: PlayerTrack, v: CourseVersion): number {
  const n = Number(lsGet(posKey(t, v)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "metadata";
  a.addEventListener("loadedmetadata", () => emit({ duration: a.duration || 0 }));
  a.addEventListener("durationchange", () => emit({ duration: a.duration || 0 }));
  a.addEventListener("playing", () => {
    lastTick = a.currentTime;
    emit({ playing: true, loading: false, error: null });
    setMediaState();
  });
  a.addEventListener("pause", () => {
    lastTick = null;
    savePos(true);
    emit({ playing: false });
    setMediaState();
  });
  a.addEventListener("waiting", () => emit({ loading: true }));
  a.addEventListener("seeking", () => {
    lastTick = null; // a jump is not listening
  });
  a.addEventListener("seeked", () => {
    lastTick = a.paused ? null : a.currentTime;
    emit({ current: a.currentTime });
  });
  a.addEventListener("timeupdate", () => {
    const t = a.currentTime;
    if (lastTick !== null && !a.paused) {
      const d = t - lastTick;
      // Only steady forward progress counts (timeupdate fires ~4×/s).
      if (d > 0 && d < 2) playedSec += d;
    }
    lastTick = a.paused ? null : t;
    emit({ current: t });
    savePos(false);
    checkListened();
  });
  a.addEventListener("ended", () => {
    if (pendingSession) {
      // The intro finished: straight into the session, no tap needed.
      void startPendingSession();
      return;
    }
    if (state.track) lsSet(posKey(state.track, state.version), "0");
    checkListened(true);
    emit({ playing: false, current: 0 });
  });
  a.addEventListener("error", () => {
    if (pendingSession) {
      void startPendingSession(); // intro failed mid-way: go to the session
      return;
    }
    // A link that expired while paused: fetch a fresh one once and carry on.
    if (state.track && !retriedLink && !objectUrl) {
      retriedLink = true;
      const at = a.currentTime || savedPosition(state.track, state.version);
      void load(state.track, state.version, { autoplay: !a.paused || state.playing, at });
      return;
    }
    emit({ playing: false, loading: false, error: "This track would not play. Check your connection and try again." });
  });
  audio = a;
  return a;
}

function savePos(force: boolean) {
  if (!state.track || !audio || state.track.kind === "intro") return;
  const now = Date.now();
  if (!force && now - lastSaved < 5000) return;
  lastSaved = now;
  lsSet(posKey(state.track, state.version), String(Math.floor(audio.currentTime)));
  lsSet(playedKey(state.track, state.version), String(Math.floor(playedSec)));
}

function checkListened(ended = false) {
  const t = state.track;
  if (!t || !audio || state.counted || t.kind === "intro") return;
  const dur = audio.duration;
  if (!dur || !Number.isFinite(dur)) return;
  if (playedSec / dur < LISTEN_FRACTION && !(ended && playedSec / dur >= LISTEN_FRACTION - 0.05)) return;
  if (lsGet(countedKey(t))) {
    emit({ counted: true });
    return;
  }
  lsSet(countedKey(t), "1");
  emit({ counted: true });
  const body = JSON.stringify({ token, action: "listen", course: t.courseSlug, track: t.id, version: state.version, date: todayLocal() });
  void fetch("/api/app-course", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
    .then(() => onListened?.(t.id))
    .catch(() => {
      // Offline: let a later play of the same track try again today.
      try {
        localStorage.removeItem(countedKey(t));
      } catch {
        /* ignore */
      }
    });
}

function setMediaState() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
}

function setMediaSession(t: PlayerTrack) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: "The Ochre Tree",
      album: "Calm Gut",
      artwork: [
        { src: "/ochre-app/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/ochre-app/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported action on this browser */
      }
    };
    set("play", () => void play());
    set("pause", () => pause());
    set("seekbackward", (d) => skip(-(d.seekOffset ?? 15)));
    set("seekforward", (d) => skip(d.seekOffset ?? 15));
    set("seekto", (d) => {
      if (typeof d.seekTime === "number") seek(d.seekTime);
    });
    // A guided session has no "next track"; leave the buttons off.
    set("previoustrack", null);
    set("nexttrack", null);
  } catch {
    /* MediaMetadata missing (old browser) — plain playback still works */
  }
}

function introKey(session: PlayerTrack) {
  return `ochre.course.intro.${clientKey}.${session.courseSlug}.${session.id}`;
}

/** Has this phone already played (or skipped) the intro for this session? */
export function introSeen(session: PlayerTrack): boolean {
  return !!lsGet(introKey(session));
}

async function startPendingSession() {
  const next = pendingSession;
  pendingSession = null;
  emit({ introFor: null });
  if (next) await load(next.track, next.version, { autoplay: true });
}

/**
 * The first play of a week's session: its intro first, then the session.
 * Marked as seen at the start, so a skip or a half-heard intro is not
 * forced on the listener again.
 */
export async function playWithIntro(intro: PlayerTrack, session: PlayerTrack, version: CourseVersion): Promise<void> {
  lsSet(introKey(session), new Date().toISOString());
  pendingSession = { track: session, version };
  emit({ introFor: session });
  await load({ ...intro, kind: "intro" }, "voice", { autoplay: true, at: 0 });
  // An intro that won't load must never stand between them and the session.
  if (state.error && pendingSession) await startPendingSession();
}

/** "Skip intro": go straight to the session. */
export async function skipIntro(): Promise<void> {
  if (!pendingSession) return;
  audio?.pause();
  await startPendingSession();
}

/** Change which version of the session follows the intro. */
export function setPendingVersion(v: CourseVersion) {
  if (pendingSession) pendingSession = { ...pendingSession, version: v };
}

export function configurePlayer(opts: { token: string; clientKey: string; onListened?: (trackId: string) => void }) {
  token = opts.token;
  clientKey = opts.clientKey;
  onListened = opts.onListened ?? null;
}

async function fetchLink(t: PlayerTrack, v: CourseVersion): Promise<string> {
  const res = await fetch("/api/app-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action: "audio", course: t.courseSlug, track: t.id, version: v }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !j.ok || !j.url) throw new Error(j.error || "Audio is not available right now.");
  return j.url;
}

/** Load a track (and version) and optionally start it. */
export async function load(
  t: PlayerTrack,
  v: CourseVersion,
  opts: { autoplay?: boolean; at?: number } = {},
): Promise<void> {
  const a = ensureAudio();
  const sameTrack = state.track?.id === t.id && state.track.courseSlug === t.courseSlug;
  if (state.track && (!sameTrack || state.version !== v)) savePos(true);
  if (!sameTrack || state.version !== v) {
    playedSec = Number(lsGet(playedKey(t, v))) || 0;
    retriedLink = false;
  }
  emit({
    track: t,
    version: v,
    loading: true,
    error: null,
    counted: !!lsGet(countedKey(t)),
    ...(sameTrack && state.version === v ? {} : { current: 0, duration: 0 }),
  });
  setMediaSession(t);
  try {
    let src = await offlineBlobUrl(t, v);
    if (src) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = src;
    } else {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      src = await fetchLink(t, v);
    }
    const at = opts.at ?? Math.max(0, savedPosition(t, v) - 5);
    a.src = src;
    a.load();
    if (at > 0) {
      const seekWhenReady = () => {
        try {
          a.currentTime = at;
        } catch {
          /* not seekable yet */
        }
        a.removeEventListener("loadedmetadata", seekWhenReady);
      };
      a.addEventListener("loadedmetadata", seekWhenReady);
    }
    if (opts.autoplay) await a.play();
    else emit({ loading: false });
  } catch (e) {
    emit({ loading: false, playing: false, error: e instanceof Error ? e.message : "Could not start this track." });
  }
}

export async function play(): Promise<void> {
  const a = ensureAudio();
  if (!state.track) return;
  if (!a.src) {
    await load(state.track, state.version, { autoplay: true });
    return;
  }
  try {
    await a.play();
  } catch {
    emit({ error: "Tap play again to start." });
  }
}

export function pause() {
  audio?.pause();
}

export function seek(sec: number) {
  if (!audio) return;
  const d = audio.duration || 0;
  audio.currentTime = Math.max(0, Math.min(d ? d - 0.5 : sec, sec));
  emit({ current: audio.currentTime });
  savePos(true);
}

export function skip(delta: number) {
  if (!audio) return;
  seek(audio.currentTime + delta);
}

/** Stop and forget the current track (closing the player for good). */
export function stop() {
  pendingSession = null;
  if (!audio) return;
  savePos(true);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  emit({ track: null, playing: false, current: 0, duration: 0, loading: false, error: null, introFor: null });
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) navigator.mediaSession.metadata = null;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
