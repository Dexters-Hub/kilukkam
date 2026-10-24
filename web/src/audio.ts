import type { InstrumentId } from '@kilukkam/shared';
import { beatsToSeconds, midiToFreq } from './music.js';

// WebAudio synth voices, no samples. Each note builds a short-lived graph:
//   voice → expression (slide to swell) → gate (lift to release) → out
// Voices schedule against a start time on any BaseAudioContext, so the same
// code plays live and renders the conductor's recording offline.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const noiseByRate = new Map<number, AudioBuffer>();

type Ctor = typeof AudioContext;

const audioCtor = (): Ctor | undefined => {
  const w = window as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
};

/** A master bus with gentle compression so a crowd of notes never clips. */
const masterBus = (c: BaseAudioContext, level = 0.8): GainNode => {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  const bus = c.createGain();
  bus.gain.value = level;
  bus.connect(comp).connect(c.destination);
  return bus;
};

/**
 * Create or resume the AudioContext. Must run inside a user gesture
 * (pointerdown/click) the first time or iOS keeps it suspended.
 */
export function unlockAudio(): AudioContext | null {
  if (!ctx) {
    const C = audioCtor();
    if (!C) return null;
    ctx = new C({ latencyHint: 'interactive' });
    out = masterBus(ctx);
    // iOS: a silent buffer played in the gesture fully unlocks output.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const audioReady = (): boolean => ctx !== null && ctx.state === 'running';

const noiseBuffer = (c: BaseAudioContext): AudioBuffer => {
  const cached = noiseByRate.get(c.sampleRate);
  if (cached) return cached;
  const len = Math.floor(c.sampleRate * 1.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseByRate.set(c.sampleRate, buf);
  return buf;
};

interface Envelope {
  attack: number;
  sustain: number;
  release: number;
}

/** Linear attack to peak, hold at sustain level, exponential release. Returns the end time. */
const envelope = (g: AudioParam, t0: number, hold: number, peak: number, env: Envelope): number => {
  const end = t0 + Math.max(hold, env.attack) + env.release;
  g.setValueAtTime(0.0001, t0);
  g.linearRampToValueAtTime(peak, t0 + env.attack);
  g.setTargetAtTime(peak * env.sustain, t0 + env.attack, 0.08);
  g.setValueAtTime(peak * env.sustain, t0 + Math.max(hold, env.attack));
  g.exponentialRampToValueAtTime(0.0001, end);
  return end;
};

/** What a voice hands back so a held note can be shaped and let go. */
interface Built {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Vibrato depth control, null for instruments without vibrato */
  vibrato: GainNode | null;
  vibratoBase: number;
  /** Seconds the voice takes to ring off once released */
  release: number;
  end: number;
}

/** Sine LFO on oscillator frequency, faded in after `delay` like a player's vibrato. */
const vibrato = (c: BaseAudioContext, targets: OscillatorNode[], t0: number, end: number, rate: number, depthHz: number, delay: number) => {
  const lfo = c.createOscillator();
  lfo.frequency.value = rate;
  const depth = c.createGain();
  depth.gain.setValueAtTime(0, t0);
  depth.gain.linearRampToValueAtTime(0, t0 + delay);
  depth.gain.linearRampToValueAtTime(depthHz, t0 + delay + 0.25);
  lfo.connect(depth);
  for (const o of targets) depth.connect(o.frequency);
  lfo.start(t0);
  lfo.stop(end);
  return { lfo, depth };
};

const bowed = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number, dark: boolean): Built => {
  const env: Envelope = dark ? { attack: 0.12, sustain: 0.75, release: 0.6 } : { attack: 0.07, sustain: 0.7, release: 0.28 };
  const vca = c.createGain();
  const end = envelope(vca.gain, t0, hold, peak, env);

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = dark ? 0.9 : 1.2;
  const cutoff = dark ? Math.min(1400, f * 5) : Math.min(4200, f * 7);
  lp.frequency.setValueAtTime(cutoff * 0.5, t0);
  lp.frequency.linearRampToValueAtTime(cutoff, t0 + env.attack * 1.5);

  // Two slightly detuned saws for a section-ish body.
  const a = c.createOscillator();
  const b = c.createOscillator();
  a.type = b.type = 'sawtooth';
  a.frequency.value = b.frequency.value = f;
  a.detune.value = -5;
  b.detune.value = 5;
  const mix = c.createGain();
  mix.gain.value = 0.5;
  a.connect(mix);
  b.connect(mix);
  mix.connect(lp).connect(vca).connect(dest);

  const base = f * (dark ? 0.004 : 0.006);
  const vib = vibrato(c, [a, b], t0, end, dark ? 4.8 : 5.6, base, 0.18);
  return { sources: [a, b, vib.lfo], nodes: [mix, lp, vca, vib.depth], vibrato: vib.depth, vibratoBase: base, release: env.release, end };
};

const flute = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number): Built => {
  const env: Envelope = { attack: 0.06, sustain: 0.8, release: 0.18 };
  const vca = c.createGain();
  const end = envelope(vca.gain, t0, hold, peak, env);

  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  const harm = c.createOscillator();
  harm.type = 'sine';
  harm.frequency.value = f * 2;
  const hg = c.createGain();
  hg.gain.value = 0.12;
  o.connect(vca);
  harm.connect(hg).connect(vca);
  vca.connect(dest);
  const base = f * 0.004;
  const vib = vibrato(c, [o, harm], t0, end, 4.6, base, 0.22);

  // Breath: band-passed noise, loudest in the chiff then settling low.
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c);
  n.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(8000, f * 2.5);
  bp.Q.value = 1.4;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.linearRampToValueAtTime(peak * 0.35, t0 + 0.03);
  ng.gain.setTargetAtTime(peak * 0.07, t0 + 0.03, 0.06);
  ng.gain.setValueAtTime(peak * 0.07, t0 + Math.max(hold, env.attack));
  ng.gain.exponentialRampToValueAtTime(0.0001, end);
  n.connect(bp).connect(ng).connect(dest);

  return { sources: [o, harm, n, vib.lfo], nodes: [hg, vca, bp, ng, vib.depth], vibrato: vib.depth, vibratoBase: base, release: env.release, end };
};

const piano = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number): Built => {
  // Percussive: near-instant attack, decay that shortens up the keyboard.
  // Holding acts like the sustain pedal: the tail lasts as long as the hold.
  const decay = Math.min(6, Math.max(0.5, hold + 0.4) * (f > 600 ? 0.7 : 1));
  const end = t0 + decay;
  const vca = c.createGain();
  vca.gain.setValueAtTime(0.0001, t0);
  vca.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  vca.gain.setTargetAtTime(peak * 0.35, t0 + 0.005, 0.09);
  vca.gain.exponentialRampToValueAtTime(0.0001, end);

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(9000, f * 10), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.min(3000, f * 3), t0 + 0.3);

  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [vca, lp];
  for (const [mult, type, gain] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]] as const) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    const g = c.createGain();
    g.gain.value = gain;
    o.connect(g).connect(lp);
    sources.push(o);
    nodes.push(g);
  }
  lp.connect(vca).connect(dest);
  return { sources, nodes, vibrato: null, vibratoBase: 0, release: 0.25, end };
};

const LEVEL: Record<InstrumentId, number> = { violin: 1, cello: 1.15, flute: 1, piano: 1.1 };

const build = (c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, f: number, t0: number, hold: number, peak: number): Built => {
  switch (instrument) {
    case 'violin':
      return bowed(c, dest, f, t0, hold, peak, false);
    case 'cello':
      return bowed(c, dest, f, t0, hold, peak, true);
    case 'flute':
      return flute(c, dest, f, t0, hold, peak);
    case 'piano':
      return piano(c, dest, f, t0, hold, peak);
  }
};

const peakFor = (instrument: InstrumentId, velocity: number, level = 1): number =>
  0.32 * LEVEL[instrument] * level * Math.min(1, Math.max(0.1, velocity / 127));

/** Written length in seconds, clamped so very short notes still speak and long ones end. */
export const noteSeconds = (beats: number, bpm: number): number => Math.min(4, Math.max(0.12, beatsToSeconds(beats, bpm)));

/** Longest a held note may sustain before it lets go by itself */
const MAX_HOLD = 8;

export interface Voice {
  /** Finger lifted: ring off, but never before the note's written length */
  release(): void;
  /** Slide gesture: 0.3 (whisper) to 1.6 (full), 1 is as written */
  express(level: number): void;
  /** Wiggle gesture: 0 (none) to 1 (wide vibrato) */
  wobble(amount: number): void;
}

const SILENT: Voice = { release: () => {}, express: () => {}, wobble: () => {} };

/**
 * Play one score event on this phone. `beats` and `bpm` come straight from
 * the Score. With `held`, the note sustains until release() (or MAX_HOLD).
 */
export function playNote(instrument: InstrumentId, midi: number, beats: number, bpm: number, velocity = 96, opts: { held?: boolean; level?: number } = {}): Voice {
  const c = unlockAudio();
  if (!c || !out) return SILENT;
  const t0 = c.currentTime + 0.005;
  const written = noteSeconds(beats, bpm);
  const hold = opts.held ? MAX_HOLD : written;

  const gate = c.createGain();
  const expr = c.createGain();
  expr.connect(gate).connect(out);
  const v = build(c, expr, instrument, midiToFreq(midi), t0, hold, peakFor(instrument, velocity, opts.level));
  const all = [...v.nodes, expr, gate];
  const last = v.sources[0];
  if (last) last.onended = () => all.forEach((n) => n.disconnect());
  for (const s of v.sources) {
    s.start(t0);
    s.stop(v.end);
  }

  let released = !opts.held;
  return {
    release: () => {
      if (released) return;
      released = true;
      const at = Math.max(c.currentTime, t0 + written);
      gate.gain.setTargetAtTime(0, at, v.release / 3);
      const stop = at + v.release * 2.5;
      for (const s of v.sources) {
        try {
          s.stop(stop);
        } catch {
          // already stopped on its own
        }
      }
    },
    express: (level) => expr.gain.setTargetAtTime(Math.max(0.3, Math.min(1.6, level)), c.currentTime, 0.06),
    wobble: (amount) => v.vibrato?.gain.setTargetAtTime(v.vibratoBase * (1 + Math.max(0, Math.min(1, amount)) * 4), c.currentTime, 0.05),
  };
}

/** Schedule a note at an exact time on any context: used to render recordings offline. */
export function renderNote(c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, midi: number, beats: number, bpm: number, t0: number, velocity = 96, level = 1): void {
  const v = build(c, dest, instrument, midiToFreq(midi), t0, noteSeconds(beats, bpm), peakFor(instrument, velocity, level));
  for (const s of v.sources) {
    s.start(t0);
    s.stop(v.end);
  }
}

export { masterBus };

/** A soft, dull knock for taps that can't play (not started, no track, finished). */
export function thunk(): void {
  const c = unlockAudio();
  if (!c || !out) return;
  const t0 = c.currentTime + 0.005;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t0);
  o.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.18, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + 0.15);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

/** A bright two-note chime for the sound check: if you hear this, you're ready. */
export function chime(): void {
  const c = unlockAudio();
  if (!c || !out) return;
  [[76, 0], [83, 0.12]].forEach(([midi, dt]) => renderNote(c, out as GainNode, 'piano', midi ?? 76, 1, 120, c.currentTime + 0.01 + (dt ?? 0), 100));
}
