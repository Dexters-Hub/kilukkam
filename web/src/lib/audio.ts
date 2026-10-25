import type { InstrumentId } from '@kilukkam/shared';
import { beatsToSeconds, midiToFreq } from './music.js';
import type { RenderNote } from './recording.js';
import { BANKS_FOR, BANK_NOTES, SHAPES, TONE, loopRegion, nearestSample, pickBank, rateFor, sampleUrl, shapeFor, type BankId } from './samples.js';

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
  /** Wiggle gesture: widen the vibrato, 0 to 1 */
  wobble: (amount: number, now: number) => void;
  /** Seconds the voice takes to ring off once released */
  release: number;
  end: number;
}

/** Sine LFO on oscillator frequency, faded in after `delay` like a player's vibrato. */
const vibrato = (c: BaseAudioContext, targets: OscillatorNode[], t0: number, rate: number, depthHz: number, delay: number) => {
  const lfo = c.createOscillator();
  lfo.frequency.value = rate;
  const depth = c.createGain();
  depth.gain.setValueAtTime(0, t0);
  depth.gain.linearRampToValueAtTime(0, t0 + delay);
  depth.gain.linearRampToValueAtTime(depthHz, t0 + delay + 0.25);
  lfo.connect(depth);
  for (const o of targets) depth.connect(o.frequency);
  // Started and stopped with the voice's other sources by the caller.
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
  const vib = vibrato(c, [a, b], t0, dark ? 4.8 : 5.6, base, 0.18);
  const wobble = (amount: number, now: number) => vib.depth.gain.setTargetAtTime(base * (1 + amount * 4), now, 0.05);
  return { sources: [a, b, vib.lfo], nodes: [mix, lp, vca, vib.depth], wobble, release: env.release, end };
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
  const vib = vibrato(c, [o, harm], t0, 4.6, base, 0.22);

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

  const wobble = (amount: number, now: number) => vib.depth.gain.setTargetAtTime(base * (1 + amount * 4), now, 0.05);
  return { sources: [o, harm, n, vib.lfo], nodes: [hg, vca, bp, ng, vib.depth], wobble, release: env.release, end };
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
  return { sources, nodes, wobble: () => {}, release: 0.25, end };
};

// ---------- recorded instruments ----------

type Bank = Map<number, AudioBuffer>;
const banks = new Map<BankId, Bank>();
const loading = new Map<InstrumentId, Promise<boolean>>();

const fetchBank = async (decoder: BaseAudioContext, bank: BankId): Promise<Bank> => {
  const out: Bank = new Map();
  await Promise.all(
    BANK_NOTES[bank].map(async (midi) => {
      const res = await fetch(sampleUrl(bank, midi));
      if (!res.ok) throw new Error(`sample ${bank}/${midi}: ${res.status}`);
      out.set(midi, await decoder.decodeAudioData(await res.arrayBuffer()));
    }),
  );
  return out;
};

/**
 * Fetch and decode an instrument's recordings: the sustained bank first (the
 * phone can play as soon as it lands), then its short and soft articulations.
 * Decoding runs on an offline context so it can start before any user gesture.
 * Resolves false (synth fallback) if the main bank fails.
 */
export function preloadInstrument(instrument: InstrumentId): Promise<boolean> {
  const pending = loading.get(instrument);
  if (pending) return pending;
  const job = (async () => {
    const Offline = (window as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Offline) return false;
    const decoder = new Offline(1, 1, 44100);
    const [main, ...extras] = BANKS_FOR[instrument];
    if (!main) return false;
    banks.set(main, await fetchBank(decoder, main));
    for (const bank of extras) {
      fetchBank(decoder, bank).then(
        (b) => banks.set(bank, b),
        (err: unknown) => console.warn(`Optional articulation ${bank} unavailable`, err),
      );
    }
    return true;
  })().catch((err: unknown) => {
    console.warn('Using synth voice; samples failed to load', err);
    loading.delete(instrument);
    return false;
  });
  loading.set(instrument, job);
  return job;
}

export const instrumentReady = (instrument: InstrumentId): boolean => banks.has(instrument);

/** Shelving EQ (and an optional stage position) that gives each instrument its colour. */
const toneChain = (c: BaseAudioContext, instrument: InstrumentId, dest: AudioNode, spread: boolean): { input: AudioNode; nodes: AudioNode[] } => {
  const tone = TONE[instrument];
  const low = c.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = tone.low.freq;
  low.gain.value = tone.low.gain;
  const high = c.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = tone.high.freq;
  high.gain.value = tone.high.gain;
  low.connect(high);
  const nodes: AudioNode[] = [low, high];
  if (spread && 'createStereoPanner' in c) {
    const pan = c.createStereoPanner();
    pan.pan.value = tone.pan;
    high.connect(pan).connect(dest);
    nodes.push(pan);
  } else {
    high.connect(dest);
  }
  return { input: low, nodes };
};

interface NoteSpec {
  /** Written length in seconds, used to pick an articulation */
  seconds: number;
  velocity: number;
  held: boolean;
  /** Place the instrument on the stereo stage (recordings), instead of the centre (a phone speaker) */
  spread: boolean;
}

const sampled = (c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, midi: number, t0: number, hold: number, gain: number, spec: NoteSpec): Built | null => {
  if (!banks.has(instrument)) return null;
  const bankId = pickBank(instrument, spec.seconds, spec.velocity, spec.held, (b) => banks.has(b));
  const bank = banks.get(bankId);
  const from = bank && nearestSample(BANK_NOTES[bankId], midi);
  const buffer = from === undefined ? undefined : bank?.get(from);
  if (!buffer || from === undefined) return null;
  const shape = shapeFor(bankId, instrument);

  const src = c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rateFor(from, midi);
  const playable = buffer.duration / src.playbackRate.value;
  const loop = shape.loops && hold > playable - 0.5 ? loopRegion(buffer.duration) : null;
  if (loop) {
    src.loop = true;
    src.loopStart = loop.start;
    src.loopEnd = loop.end;
  }
  // Piano rings on its own; the others hold their level for the written or held length.
  const sustainEnd = t0 + Math.max(shape.attack, shape.loops ? hold : Math.min(hold, playable));
  const end = Math.min(sustainEnd + shape.release, loop ? Infinity : t0 + playable);
  const vca = c.createGain();
  vca.gain.setValueAtTime(0, t0);
  vca.gain.linearRampToValueAtTime(gain, t0 + shape.attack);
  vca.gain.setValueAtTime(gain, sustainEnd);
  vca.gain.exponentialRampToValueAtTime(0.0001, Math.max(sustainEnd + 0.01, end));

  // The recordings already carry a player's vibrato; the wiggle gesture adds more.
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.5;
  const depth = c.createGain();
  depth.gain.value = 0;
  lfo.connect(depth).connect(src.detune);
  const tone = toneChain(c, instrument, dest, spec.spread);
  src.connect(vca).connect(tone.input);
  const wobble = (amount: number, now: number) => depth.gain.setTargetAtTime(amount * 35, now, 0.05);
  return { sources: [src, lfo], nodes: [vca, depth, ...tone.nodes], wobble, release: shape.release, end };
};

const LEVEL: Record<InstrumentId, number> = { violin: 1, cello: 1.15, flute: 1, piano: 1.1, drums: 1.25, guitar: 1.3 };

/**
 * A plucked string, Karplus-Strong: a burst of noise circulating through a
 * delay one period long, averaged a little on each pass, so the brightness
 * fades first and the fundamental rings on, like a nylon string. Each pitch
 * is rendered once per context and cached.
 */
const plucked = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const pluckBuffer = (c: BaseAudioContext, midi: number): AudioBuffer => {
  let byNote = plucked.get(c);
  if (!byNote) {
    byNote = new Map();
    plucked.set(c, byNote);
  }
  const cached = byNote.get(midi);
  if (cached) return cached;
  const sr = c.sampleRate;
  const f = midiToFreq(midi);
  const period = Math.max(2, Math.round(sr / f));
  const length = Math.round(sr * 3.2);
  const b = c.createBuffer(1, length, sr);
  const out = b.getChannelData(0);
  // A finger pluck is softer than a pick: smooth the initial noise once.
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const n = Math.random() * 2 - 1;
    prev = 0.55 * n + 0.45 * prev;
    out[i] = prev;
  }
  // Higher strings ring shorter, as they do on a real guitar.
  const decay = 0.9985 - Math.min(0.006, (f / 1000) * 0.004);
  for (let i = period; i < length; i++) out[i] = decay * 0.5 * ((out[i - period] ?? 0) + (out[i - period - 1] ?? 0));
  byNote.set(midi, b);
  return b;
};

const guitar = (c: BaseAudioContext, dest: AudioNode, midi: number, t0: number, hold: number, peak: number): Built => {
  const src = c.createBufferSource();
  src.buffer = pluckBuffer(c, midi);
  // The guitar body: a warm low resonance and a gentle top roll-off.
  const body = c.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 110;
  body.gain.value = 4;
  const top = c.createBiquadFilter();
  top.type = 'lowpass';
  top.frequency.value = 4200;
  const vca = c.createGain();
  // Let a plucked note ring past a short written length, then damp it.
  const ring = Math.min(3, Math.max(1.1, hold + 0.6));
  const end = t0 + ring;
  vca.gain.setValueAtTime(peak * 2.2, t0);
  vca.gain.setValueAtTime(peak * 2.2, end - 0.25);
  vca.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(body).connect(top).connect(vca).connect(dest);
  return { sources: [src], nodes: [body, top, vca], wobble: () => {}, release: 0.2, end };
};

/** One shared second of white noise per context, the raw material of snares, hats and cymbals. */
const noiseFor = new WeakMap<BaseAudioContext, AudioBuffer>();
const noise = (c: BaseAudioContext): AudioBuffer => {
  let b = noiseFor.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseFor.set(c, b);
  }
  return b;
};

/**
 * The drum kit, synthesised and keyed like General MIDI drums: 35/36 kick,
 * 38/40 snare, 39 clap, 42/44 closed hat, 46 open hat, 41 to 50 toms,
 * 49/57 crash. Anything else plays a rim click. A drum hit ignores the
 * written length; it rings for as long as that drum does.
 */
const drum = (c: BaseAudioContext, dest: AudioNode, midi: number, t0: number, peak: number): Built => {
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const out = c.createGain();
  out.connect(dest);
  nodes.push(out);
  const env = (g: GainNode, level: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  };
  const tone = (from: number, to: number, sweep: number, level: number, decay: number, type: OscillatorType = 'sine') => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + sweep);
    const g = c.createGain();
    env(g, level, decay);
    o.connect(g).connect(out);
    sources.push(o);
    nodes.push(g);
    return decay;
  };
  const hiss = (type: BiquadFilterType, freq: number, level: number, decay: number, delay = 0) => {
    const n = c.createBufferSource();
    n.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + delay);
    g.gain.linearRampToValueAtTime(level, t0 + delay + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + decay);
    n.connect(f).connect(g).connect(out);
    sources.push(n);
    nodes.push(f, g);
    return delay + decay;
  };
  let ring: number;
  if (midi === 35 || midi === 36) {
    ring = tone(160, 42, 0.11, peak * 1.6, 0.42);
    hiss('lowpass', 2500, peak * 0.25, 0.012);
  } else if (midi === 38 || midi === 40) {
    tone(220, 160, 0.06, peak * 0.7, 0.14, 'triangle');
    ring = hiss('highpass', 1400, peak * 0.9, 0.2);
  } else if (midi === 39) {
    ring = Math.max(hiss('bandpass', 1300, peak, 0.03), hiss('bandpass', 1300, peak, 0.03, 0.012), hiss('bandpass', 1300, peak * 1.1, 0.16, 0.024));
  } else if (midi === 42 || midi === 44) {
    ring = hiss('highpass', 7500, peak * 0.55, 0.05);
  } else if (midi === 46) {
    ring = hiss('highpass', 7000, peak * 0.5, 0.32);
  } else if (midi === 49 || midi === 57) {
    ring = hiss('highpass', 5200, peak * 0.6, 1.3);
  } else if (midi >= 41 && midi <= 50) {
    const f = 70 + (midi - 41) * 16;
    ring = tone(f * 1.6, f, 0.09, peak * 1.2, 0.36);
  } else {
    ring = tone(1700, 1200, 0.02, peak * 0.6, 0.04, 'square');
  }
  return { sources, nodes, wobble: () => {}, release: 0.05, end: t0 + ring + 0.05 };
};

/** Synth voice: always available, used until (or if) the recordings load. */
const synth = (c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, f: number, t0: number, hold: number, peak: number): Built => {
  switch (instrument) {
    case 'violin':
      return bowed(c, dest, f, t0, hold, peak, false);
    case 'cello':
      return bowed(c, dest, f, t0, hold, peak, true);
    case 'flute':
      return flute(c, dest, f, t0, hold, peak);
    case 'piano':
      return piano(c, dest, f, t0, hold, peak);
    case 'drums':
      return drum(c, dest, Math.round(69 + 12 * Math.log2(f / 440)), t0, peak);
    case 'guitar':
      return guitar(c, dest, Math.round(69 + 12 * Math.log2(f / 440)), t0, hold, peak);
  }
};

const build = (c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, midi: number, t0: number, hold: number, velocity: number, level: number, spec: NoteSpec): Built =>
  sampled(c, dest, instrument, midi, t0, hold, 1.6 * SHAPES[instrument].level * level * Math.min(1, Math.max(0.1, velocity / 127)), spec) ??
  synth(c, dest, instrument, midiToFreq(midi), t0, hold, peakFor(instrument, velocity, level));

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
export function playNote(instrument: InstrumentId, midi: number, beats: number, bpm: number, velocity = 96, opts: { held?: boolean; level?: number; delay?: number } = {}): Voice {
  const c = unlockAudio();
  if (!c || !out) return SILENT;
  const t0 = c.currentTime + 0.005 + Math.max(0, opts.delay ?? 0);
  const written = noteSeconds(beats, bpm);
  const hold = opts.held ? MAX_HOLD : written;

  const gate = c.createGain();
  const expr = c.createGain();
  expr.connect(gate).connect(out);
  const v = build(c, expr, instrument, midi, t0, hold, velocity, opts.level ?? 1, { seconds: written, velocity, held: opts.held ?? false, spread: false });
  const all = [...v.nodes, expr, gate];
  const last = v.sources[0];
  if (last) last.onended = () => all.forEach((n) => n.disconnect());
  for (const s of v.sources) {
    s.start(t0);
    if (Number.isFinite(v.end)) s.stop(v.end);
    else s.stop(t0 + MAX_HOLD + 2);
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
    wobble: (amount) => v.wobble(Math.max(0, Math.min(1, amount)), c.currentTime),
  };
}

/** Schedule a note at an exact time on any context: used to render recordings offline. */
export function renderNote(c: BaseAudioContext, dest: AudioNode, instrument: InstrumentId, midi: number, beats: number, bpm: number, t0: number, velocity = 96, level = 1, spread = true): void {
  const seconds = noteSeconds(beats, bpm);
  const v = build(c, dest, instrument, midi, t0, seconds, velocity, level, { seconds, velocity, held: false, spread });
  for (const s of v.sources) {
    s.start(t0);
    s.stop(Number.isFinite(v.end) ? v.end : t0 + MAX_HOLD + 2);
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

/**
 * Kilukkam: a little handbell rung three times, quickly. Inharmonic sine
 * partials with a fast strike and a long shimmer, so a room of phones
 * ringing it together sounds like a bell tree, not a beep.
 */
export function bell(): void {
  const c = unlockAudio();
  const bus = out;
  if (!c || !bus) return;
  const partials: readonly [number, number][] = [[1, 0.22], [2.76, 0.12], [5.4, 0.07], [8.93, 0.04]];
  [0, 0.09, 0.18].forEach((dt, strike) => {
    const t0 = c.currentTime + 0.01 + dt;
    const f0 = 1568 * (strike === 1 ? 1.122 : 1);
    for (const [ratio, level] of partials) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * ratio, t0);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4 / ratio ** 0.5);
      o.connect(g).connect(bus);
      o.start(t0);
      o.stop(t0 + 1.5);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    }
  });
}

/**
 * Render a recorded take to audio offline, through the same instruments and
 * master bus the room heard, for the replay player and the WAV download.
 * Null when the browser has no OfflineAudioContext.
 */
export async function renderTake(notes: readonly RenderNote[], seconds: number, bpm: number, sampleRate = 44100): Promise<AudioBuffer | null> {
  const Offline = (window as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return null;
  await Promise.all([...new Set(notes.map((n) => n.instrument))].map((i) => preloadInstrument(i)));
  const c = new Offline(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
  const bus = masterBus(c);
  for (const n of notes) {
    const written = noteSeconds(n.beats, bpm);
    const t0 = n.t + 0.05;
    const v = build(c, bus, n.instrument, n.midi, t0, written, n.velocity, n.level, { seconds: written, velocity: n.velocity, held: false, spread: false });
    for (const src of v.sources) {
      src.start(t0);
      src.stop(Number.isFinite(v.end) ? v.end : t0 + written + 2);
    }
  }
  return c.startRendering();
}

/** Play a rendered buffer on the live context from `offset` seconds; returns its stop. */
export function playBuffer(buffer: AudioBuffer, offset: number, onEnded: () => void): () => void {
  const c = unlockAudio();
  if (!c || !out) return () => {};
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  src.onended = onEnded;
  src.start(0, Math.max(0, Math.min(offset, buffer.duration)));
  return () => {
    src.onended = null;
    try {
      src.stop();
    } catch {
      // Already finished.
    }
  };
}

/** The live context's clock, for a playhead. */
export const audioNow = (): number => ctx?.currentTime ?? 0;

