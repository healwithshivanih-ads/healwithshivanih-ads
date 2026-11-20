/**
 * SOUND FOR THE PRACTICES — the coach's voice over a quiet bed of music and
 * the scene's own sound. Web Audio, ported from the prototype's `Snd`.
 *
 * Three things play:
 *   - the bed: a soft drone, the scene's sound (rain, waves, wind) and a slow
 *     wandering tune. All of it is made here from oscillators and noise, so
 *     there is nothing to download.
 *   - the voice: one recorded clip at a time (public/app-voice/). While it
 *     speaks, the bed is turned down ("ducked") and comes back after.
 *   - a bell, on steps that have no voice.
 *
 * Phones only play sound after a tap. `unlock()` must be called from inside a
 * tap handler (the button that opens a practice); everything else can then
 * run from timers. With the phone's silent switch on, an iPhone plays nothing
 * at all — the words stay on screen, which is why every step has them.
 *
 * Voice volume has five levels and goes through a limiter, so the top level
 * is loud without clipping. Pace is not here: it changes the pauses between
 * clips (sq-practice-data.ts), never the clips.
 *
 * Everything fails quiet: no AudioContext, a clip that will not load, a
 * decode error — the practice carries on in text.
 */

import { voiceUrl, type SceneKey, type VoiceSet } from "./sq-practice-data";

const VOICE_GAIN = [0.5, 0.9, 1.6, 2.4, 3.2];

type AC = AudioContext;

class SqSound {
  private ctx: AC | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private tuneTimer: ReturnType<typeof setInterval> | null = null;
  private birdTimer: ReturnType<typeof setInterval> | null = null;
  private voice: AudioBufferSourceNode | null = null;
  private clips = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  /** bumped on every say/hush, so a clip that finishes loading late stays silent */
  private turn = 0;

  voiceOn = true;
  musicOn = true;
  /** the scene's own sound (rain, waves, wind, birdsong); its own switch */
  natureOn = true;
  /** Turn the music down while the voice speaks. Off for the sleep wind-down,
   *  where the coach wanted the music steady under her voice (19 Nov 2026). */
  duckOn = true;
  volume = 2;

  /** Call from a tap. Creates the audio context and wakes it, and asks the
   *  phone to treat this as media playback (see `asPlayback`). */
  unlock(): void {
    this.asPlayback();
    this.ensure();
  }

  private keepAlive: HTMLAudioElement | null = null;

  /** Restart the silent loop if something paused it. Allowed outside a tap
   *  once the first tap has played it. */
  private holdPlayback(): void {
    if (this.keepAlive?.paused) void this.keepAlive.play().catch(() => {});
  }

  /**
   * On an iPhone, Web Audio follows the ring/silent switch: with the switch on
   * silent, the voice, music and bells are all muted. An <audio> element is
   * "media" and plays through the switch, the way videos and music apps do.
   * Two things move the page's sound into that category:
   *   - `navigator.audioSession.type = "playback"` (Safari 17 and later);
   *   - for older iPhones, a silent looping <audio> element started from the
   *     same tap, which switches the whole page to playback.
   * Elsewhere both are harmless; any failure is ignored.
   */
  private asPlayback(): void {
    if (typeof window === "undefined") return;
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
    } catch {
      /* not supported */
    }
    try {
      if (!this.keepAlive) {
        const a = new Audio(silentWav());
        a.loop = true;
        a.setAttribute("playsinline", "");
        a.setAttribute("aria-hidden", "true");
        this.keepAlive = a;
      }
      void this.keepAlive.play().catch(() => {});
    } catch {
      /* no audio element */
    }
  }

  private ensure(): AC | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  }

  // ── the bed ──────────────────────────────────────────────────────────────

  /** Start the bed for a scene. Safe to call again: it restarts cleanly. */
  start(scene: SceneKey): void {
    this.stop(false);
    this.holdPlayback();
    if (!this.musicOn && !this.natureOn) return;
    const c = this.ensure();
    if (!c || !this.master) return;
    const bed = c.createGain();
    bed.gain.value = 0;
    bed.connect(this.master);
    bed.gain.setTargetAtTime(1, c.currentTime, 1.4);
    this.bed = bed;

    // A warm open chord (G2 D3 G3 B3), each tone slowly swelling and softening
    // at its own rate, like breathing. Chosen by ear with the coach (19 Nov
    // 2026) in place of the old three-tone drone.
    if (this.musicOn) for (const [freq, level, rate] of [
      [98, 0.03, 0.05],
      [146.83, 0.021, 0.07],
      [196, 0.018, 0.06],
      [246.94, 0.011, 0.09],
    ]) {
      const g = c.createGain();
      g.gain.value = level * 0.65;
      g.connect(bed);
      for (const [mult, amt] of [
        [1, 1],
        [1.002, 0.3],
      ]) {
        const o = c.createOscillator();
        const og = c.createGain();
        o.frequency.value = freq * mult;
        og.gain.value = amt;
        o.connect(og);
        og.connect(g);
        o.start();
        this.nodes.push(o);
      }
      const l = c.createOscillator();
      const lg = c.createGain();
      l.frequency.value = rate;
      lg.gain.value = level * 0.35;
      l.connect(lg);
      lg.connect(g.gain);
      l.start();
      this.nodes.push(l);
    }

    // the scene: filtered noise, swelling and fading
    const band = (type: BiquadFilterType, freq: number, level: number, lfoHz: number, depth: number) => {
      const len = 2 * c.sampleRate;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = type === "bandpass" ? 0.6 : 0.5;
      const g = c.createGain();
      g.gain.value = level;
      src.connect(f);
      f.connect(g);
      g.connect(bed);
      src.start();
      this.nodes.push(src);
      if (lfoHz) {
        const l = c.createOscillator();
        const lg = c.createGain();
        l.frequency.value = lfoHz;
        lg.gain.value = depth;
        l.connect(lg);
        lg.connect(g.gain);
        l.start();
        this.nodes.push(l);
      }
    };
    if (!this.natureOn) {
      /* the client turned the scene's sound off */
    } else if (scene === "rain") {
      // Real recorded rain (public domain, "Rain" by ezwa on Wikimedia
      // Commons), a 41-second seamless loop. The coach found every filtered-
      // noise rain harsh (19 Nov 2026). Loaded only when a rain practice opens.
      void this.loadRain().then((buf) => {
        const cc = this.ctx;
        if (!buf || !cc || this.bed !== bed) return;
        const src = cc.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = cc.createGain();
        g.gain.value = 0.11; // halved at the coach's request (19 Nov 2026)
        src.connect(g);
        g.connect(bed);
        src.start();
        this.nodes.push(src);
      });
    } else if (scene === "shore") band("lowpass", 700, 0.06, 0.11, 0.05);
    else if (scene === "grass") band("lowpass", 600, 0.035, 0.09, 0.02);
    else {
      band("lowpass", 520, 0.03, 0.08, 0.018);
      this.birdTimer = setInterval(() => {
        if (Math.random() < 0.5) this.chirp();
      }, 5200);
    }

    // the tune: one soft note every few seconds, never far from the last
    const notes = [196, 220, 246.94, 293.66, 329.63, 392];
    let last = 3;
    const play = () => {
      const cc = this.ctx;
      if (!cc || !this.bed) return;
      last = Math.max(0, Math.min(notes.length - 1, last + Math.floor(Math.random() * 5) - 2));
      const t = cc.currentTime;
      for (const [mult, type, peak] of [
        [1, "sine", 0.045],
        [2, "sine", 0.012],
        [1.003, "triangle", 0.02],
      ] as [number, OscillatorType, number][]) {
        const o = cc.createOscillator();
        const g = cc.createGain();
        o.type = type;
        o.frequency.value = notes[last] * mult;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 1.4);
        g.gain.setTargetAtTime(0, t + 2.4, 1.3);
        o.connect(g);
        g.connect(this.bed);
        o.start(t);
        o.stop(t + 8);
      }
    };
    if (this.musicOn) {
      play();
      this.tuneTimer = setInterval(play, 4200);
    }
  }

  private rain: Promise<AudioBuffer | null> | null = null;
  private loadRain(): Promise<AudioBuffer | null> {
    const c = this.ctx;
    if (!c) return Promise.resolve(null);
    this.rain ??= fetch("/app-scenes/rain.m4a")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => c.decodeAudioData(bytes))
      .catch(() => {
        this.rain = null; // try again next time
        return null;
      });
    return this.rain;
  }

  private chirp(): void {
    const c = this.ctx;
    if (!c || !this.bed) return;
    const t = c.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const w = t + i * 0.16;
      o.frequency.setValueAtTime(2600 + Math.random() * 700, w);
      o.frequency.exponentialRampToValueAtTime(3400 + Math.random() * 600, w + 0.09);
      g.gain.setValueAtTime(0, w);
      g.gain.linearRampToValueAtTime(0.018, w + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, w + 0.13);
      o.connect(g);
      g.connect(this.bed);
      o.start(w);
      o.stop(w + 0.15);
    }
  }

  /** Fade the bed out and stop the voice. `release` also lets the phone's
   *  media session go (false only when a new bed starts straight after). */
  stop(release = true): void {
    this.hush();
    if (release) this.keepAlive?.pause();
    if (this.tuneTimer) clearInterval(this.tuneTimer);
    if (this.birdTimer) clearInterval(this.birdTimer);
    this.tuneTimer = this.birdTimer = null;
    const nodes = this.nodes;
    const bed = this.bed;
    this.nodes = [];
    this.bed = null;
    if (this.ctx && bed) bed.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    if (nodes.length) {
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        }
        try {
          bed?.disconnect();
        } catch {
          /* gone */
        }
      }, 1500);
    }
  }

  /** Three rising bells, then quiet: the end of a daytime practice. */
  finish(): void {
    [261.63, 329.63, 392].forEach((f, i) => this.bell(f, 0.24, i * 0.28));
    this.stop();
  }

  bell(freq = 392, peak = 0.16, delay = 0): void {
    if (!this.musicOn) return;
    const c = this.ensure();
    if (!c || !this.master) return;
    const w = c.currentTime + delay;
    for (const [mult, gm] of [
      [1, 1],
      [2.76, 0.28],
    ]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = freq * mult;
      g.gain.setValueAtTime(0, w);
      g.gain.linearRampToValueAtTime(peak * gm, w + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, w + 1.6);
      o.connect(g);
      g.connect(this.master);
      o.start(w);
      o.stop(w + 1.7);
    }
  }

  /** Breathing: the bed rises over an in-breath and falls over an
   *  out-breath, so the sound breathes with her (coach, 20 Nov 2026). */
  breathe(action: "expand" | "shrink" | "hold", secs: number): void {
    if (!this.ctx || !this.bed || action === "hold") return;
    const t = this.ctx.currentTime;
    const g = this.bed.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(action === "expand" ? 1 : 0.35, t + Math.max(0.5, secs));
  }

  // ── the voice ────────────────────────────────────────────────────────────

  private duck(on: boolean): void {
    if (on && !this.duckOn) return;
    if (this.ctx && this.bed) this.bed.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, 0.25);
  }

  private load(set: VoiceSet, i: number): Promise<AudioBuffer | null> {
    const key = `${set}:${i}`;
    const have = this.clips.get(key);
    if (have) return Promise.resolve(have);
    const going = this.loading.get(key);
    if (going) return going;
    const c = this.ensure();
    if (!c) return Promise.resolve(null);
    const p = fetch(voiceUrl(set, i))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => c.decodeAudioData(bytes))
      .then((buf) => {
        this.clips.set(key, buf);
        return buf as AudioBuffer | null;
      })
      .catch(() => null)
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  /** Fetch and decode clips ahead of the moment they are needed. */
  preload(clips: [VoiceSet, number][]): void {
    if (!this.voiceOn) return;
    for (const [set, i] of clips) void this.load(set, i);
  }

  /** Speak one clip. Anything already speaking stops first. */
  say(set: VoiceSet, i: number): void {
    if (!this.voiceOn) return;
    this.holdPlayback();
    const mine = ++this.turn;
    void this.load(set, i).then((buf) => {
      const c = this.ctx;
      // Hushed or superseded while loading: stay quiet.
      if (mine !== this.turn) return;
      // The phone could not decode the clip into Web Audio: play the file
      // as plain media instead, so her voice is never simply missing.
      if (!buf || !c) return this.sayAsMedia(set, i, mine);
      this.stopVoice();
      const src = c.createBufferSource();
      const g = c.createGain();
      g.gain.value = VOICE_GAIN[this.volume] ?? VOICE_GAIN[2];
      src.buffer = buf;
      src.connect(g);
      if (!this.limiter) {
        const lim = c.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.003;
        lim.release.value = 0.1;
        lim.connect(c.destination);
        this.limiter = lim;
      }
      g.connect(this.limiter);
      this.duck(true);
      src.onended = () => {
        if (this.voice === src) {
          this.voice = null;
          this.duck(false);
        }
      };
      src.start();
      this.voice = src;
    });
  }

  private mediaVoice: HTMLAudioElement | null = null;
  private sayAsMedia(set: VoiceSet, i: number, mine: number): void {
    if (typeof Audio === "undefined" || mine !== this.turn) return;
    this.stopVoice();
    const a = new Audio(voiceUrl(set, i));
    a.setAttribute("playsinline", "");
    this.mediaVoice = a;
    this.duck(true);
    a.onended = () => {
      if (this.mediaVoice === a) {
        this.mediaVoice = null;
        this.duck(false);
      }
    };
    void a.play().catch(() => this.duck(false));
  }

  private stopVoice(): void {
    if (this.mediaVoice) {
      this.mediaVoice.onended = null;
      this.mediaVoice.pause();
      this.mediaVoice = null;
    }
    if (!this.voice) return;
    try {
      this.voice.onended = null;
      this.voice.stop();
    } catch {
      /* already ended */
    }
    this.voice = null;
  }

  /** Stop the voice now (pause, a step change, leaving the practice). */
  hush(): void {
    this.turn++;
    this.stopVoice();
    this.duck(false);
  }
}

/** Half a second of silence as a WAV data URL (8 kHz, 8-bit mono), made here
 *  so there is nothing to download. */
function silentWav(): string {
  const n = 4000;
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, "data");
  v.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "data:audio/wav;base64," + btoa(bin);
}

let shared: SqSound | null = null;
/** One sound engine for the app: an audio context is a scarce thing on a phone. */
export function sqSound(): SqSound {
  shared ??= new SqSound();
  return shared;
}
export type { SqSound };
