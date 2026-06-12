/* ======================================================================
   The Ochre Tree — breathing session audio (Web Audio, zero assets)
   ----------------------------------------------------------------------
   Three layers, all synthesized live so nothing is downloaded and the
   PWA works offline. Tuning chosen by the coach (2026-06-11) after
   A/B sampling — "drone + wave, wave much softer, bell louder":

   1. A low singing-bowl DRONE (G2 root + slight detune + fifth, with a
      slow shimmer) that holds the calm space at constant pitch.
   2. A soft ocean-breath WAVE — filtered noise that swells up through
      the inhale and washes out through the exhale. It follows the same
      per-tick breath fraction as the orb, so any prescribed pattern
      (4-7-8, box, extended exhale) is paced exactly. Deliberately
      quiet: a cue behind the drone, not a co-lead.
   3. Clear BELL chimes at each phase change (a different note for
      in / hold / out) and a warm three-note rise at completion.

   iOS requires sound to start from a user gesture — the Begin button
   tap is that gesture, so the AudioContext unlocks cleanly there.
   ====================================================================== */

// wave (filtered noise) — swells with lungs-fullness f in 0..1
const WAVE_GAIN_FLOOR = 0.01;
const WAVE_GAIN_RISE = 0.062;
const WAVE_CUT_FLOOR = 200; // lowpass Hz at empty lungs
const WAVE_CUT_RISE = 620;

// drone — constant-pitch singing bowl
const DRONE_PARTS: ReadonlyArray<readonly [number, number]> = [
  [98, 0.03], // G2 root
  [98.4, 0.022], // slight detune — slow beating warmth
  [146.83, 0.014], // D3 fifth
];
const DRONE_SHIMMER_HZ = 0.15;
const DRONE_SHIMMER_DEPTH = 0.12;

// bells
const BELL_PEAK = 0.3; // phase-change chime
const BELL_PEAK_FINISH = 0.24; // each of the three overlapping finish notes

const CHIME: Record<string, number> = {
  expand: 329.63, // E4 — breathe in
  hold: 392.0, // G4 — hold
  shrink: 293.66, // D4 — breathe out
};

export class BreathAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waveSrc: AudioBufferSourceNode | null = null;
  private waveFilter: BiquadFilterNode | null = null;
  private waveGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneNodes: OscillatorNode[] = [];
  private _enabled = true;

  get enabled(): boolean {
    return this._enabled;
  }

  /** Create / resume the context. Call from a user gesture (Begin tap). */
  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (this.ctx && this.master) {
      // quick fade rather than a hard cut
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 1 : 0, t, 0.08);
      if (on && this.ctx.state === "suspended") void this.ctx.resume();
    }
  }

  /** Two seconds of looped brown-ish noise — the raw ocean. */
  private makeNoiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 4.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  /** Start the drone + wave (idempotent). Call when the session begins. */
  start(): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master || this.waveSrc) return;

    // ---- wave: noise → lowpass → swell gain --------------------------
    this.waveSrc = this.makeNoiseSource(ctx);
    this.waveFilter = ctx.createBiquadFilter();
    this.waveFilter.type = "lowpass";
    this.waveFilter.frequency.value = WAVE_CUT_FLOOR;
    this.waveFilter.Q.value = 0.6;
    this.waveGain = ctx.createGain();
    this.waveGain.gain.value = 0;
    this.waveSrc.connect(this.waveFilter);
    this.waveFilter.connect(this.waveGain);
    this.waveGain.connect(this.master);
    this.waveSrc.start();

    // ---- drone: detuned bowl partials under a shimmering bus ---------
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.master);
    for (const [freq, level] of DRONE_PARTS) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(this.droneGain);
      osc.start();
      this.droneNodes.push(osc);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = DRONE_SHIMMER_HZ;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = DRONE_SHIMMER_DEPTH;
    lfo.connect(lfoGain);
    lfoGain.connect(this.droneGain.gain);
    lfo.start();
    this.droneNodes.push(lfo);
    // ease the bowl in so it never clicks
    this.droneGain.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
  }

  /**
   * Follow the breath. `f` is the lungs-fullness fraction 0..1 (derived
   * from the orb scale), called every engine tick (~50 ms). setTargetAtTime
   * smooths between ticks so the swell is continuous, not steppy.
   */
  tick(f: number): void {
    if (!this.ctx || !this.waveGain || !this.waveFilter) return;
    const t = this.ctx.currentTime;
    const ff = Math.min(Math.max(f, 0), 1);
    this.waveGain.gain.setTargetAtTime(WAVE_GAIN_FLOOR + WAVE_GAIN_RISE * ff, t, 0.1);
    this.waveFilter.frequency.setTargetAtTime(WAVE_CUT_FLOOR + WAVE_CUT_RISE * ff, t, 0.1);
  }

  /** Bell at a phase boundary. */
  chime(action: string): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    this.bellNote(CHIME[action] ?? CHIME.hold, ctx.currentTime, BELL_PEAK);
  }

  /** Warm three-note rise when all rounds are complete. */
  finishChime(): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    [261.63, 329.63, 392.0].forEach((freq, i) => this.bellNote(freq, t + i * 0.28, BELL_PEAK_FINISH)); // C4 E4 G4
    this.stopVoice();
  }

  /** One synthesized bell: sine fundamental + quiet inharmonic partial. */
  private bellNote(freq: number, when: number, peak: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    for (const [mult, gainMul] of [
      [1, 1],
      [2.76, 0.28], // inharmonic partial gives it a bell timbre
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak * gainMul, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
      osc.connect(g);
      g.connect(this.master);
      osc.start(when);
      osc.stop(when + 1.7);
    }
  }

  private stopVoice(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.waveGain?.gain.setTargetAtTime(0, t, 0.3);
    this.droneGain?.gain.setTargetAtTime(0, t, 0.3);
    const wave = this.waveSrc;
    const drones = this.droneNodes;
    window.setTimeout(() => {
      try {
        wave?.stop();
      } catch {
        /* already stopped */
      }
      drones.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
    }, 1200);
    this.waveSrc = null;
    this.waveFilter = null;
    this.waveGain = null;
    this.droneGain = null;
    this.droneNodes = [];
  }

  /** Pause: fade everything out and suspend the clock (saves battery). */
  suspend(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.waveGain?.gain.setTargetAtTime(0, t, 0.15);
    this.droneGain?.gain.setTargetAtTime(0, t, 0.15);
    window.setTimeout(() => void this.ctx?.suspend(), 350);
  }

  /** Resume mid-breath — drone fades back; tick() re-aims the wave. */
  resume(): void {
    if (!this.ctx) return;
    void this.ctx.resume();
    const t = this.ctx.currentTime;
    this.droneGain?.gain.setTargetAtTime(1, t, 0.3);
    // the wave restores itself on the next engine tick
  }

  /** Restarting the session: silence the old voice so start() builds fresh. */
  reset(): void {
    this.stopVoice();
  }

  /** Tear everything down (overlay closed / unmounted). */
  dispose(): void {
    try {
      this.waveSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.droneNodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    });
    this.waveSrc = null;
    this.waveFilter = null;
    this.waveGain = null;
    this.droneGain = null;
    this.droneNodes = [];
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
