// 8-bit voices: the channels of a classic home console, rebuilt in WebAudio.
// Two pulse leads (12.5, 25 or 50 percent duty), a stepped 4-bit triangle
// bass, a noise drum kit from a 15-bit shift register, and a fast arpeggio
// helper. Same contract as the synth voices in audio.ts: each builder wires
// a graph on any BaseAudioContext (live or offline) and hands back its
// sources, which the caller starts and stops exactly once.

/** What a voice hands back: the same shape as audio.ts's Built. */
export interface ChipBuilt {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Wiggle gesture: widen the vibrato, 0 to 1 */
  wobble: (amount: number, now: number) => void;
  /** Seconds the voice takes to ring off once released */
  release: number;
  end: number;
}

export type Duty = 0.125 | 0.25 | 0.5;

/** The console's pulse duty cycles are 8-step sequences: 1, 2 or 4 steps high. */
export const dutyLevels = (duty: Duty): number[] => Array.from({ length: 8 }, (_, i) => (i < duty * 8 ? 1 : 0));

/** The triangle channel steps through 32 levels: 15 down to 0, then back up. */
export const TRIANGLE_LEVELS: readonly number[] = [
  ...Array.from({ length: 16 }, (_, i) => 15 - i),
  ...Array.from({ length: 16 }, (_, i) => i),
];

/**
 * Exact Fourier series of a periodic staircase (one level per equal step), so
 * a PeriodicWave plays it band-limited: no aliasing, and the steps still buzz.
 * Returns cosine (real) and sine (imag) coefficients; index 0 is unused (DC).
 */
export const stepWaveCoefficients = (levels: readonly number[], harmonics = 64): { real: Float32Array<ArrayBuffer>; imag: Float32Array<ArrayBuffer> } => {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  const steps = levels.length;
  const mean = levels.reduce((s, v) => s + v, 0) / steps;
  for (let n = 1; n <= harmonics; n++) {
    let a = 0;
    let b = 0;
    levels.forEach((level, k) => {
      const v = level - mean;
      const from = (2 * Math.PI * n * k) / steps;
      const to = (2 * Math.PI * n * (k + 1)) / steps;
      a += v * (Math.sin(to) - Math.sin(from));
      b += v * (Math.cos(from) - Math.cos(to));
    });
    real[n] = a / (Math.PI * n);
    imag[n] = b / (Math.PI * n);
  }
  return { real, imag };
};

/**
 * The noise channel: a 15-bit linear feedback shift register, one output bit
 * per clock. Long mode (taps 0 and 1) hisses; short mode (taps 0 and 6)
 * repeats every 93 clocks and rings metallic, the classic hi-hat.
 */
export const lfsrNoise = (length: number, short: boolean, samplesPerClock = 1): Float32Array<ArrayBuffer> => {
  const out = new Float32Array(length);
  let reg = 1;
  let level = 1;
  for (let i = 0; i < length; i++) {
    if (i % samplesPerClock === 0) {
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
      reg = (reg >> 1) | (bit << 14);
      level = reg & 1 ? -1 : 1;
    }
    out[i] = level;
  }
  return out;
};

// Waves and noise are built once per context and reused by every note.
const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
const noises = new WeakMap<BaseAudioContext, Map<boolean, AudioBuffer>>();

const waveFor = (c: BaseAudioContext, key: string, levels: readonly number[]): PeriodicWave => {
  const byKey = waves.get(c) ?? new Map<string, PeriodicWave>();
  waves.set(c, byKey);
  const cached = byKey.get(key);
  if (cached) return cached;
  const { real, imag } = stepWaveCoefficients(levels);
  const wave = c.createPeriodicWave(real, imag);
  byKey.set(key, wave);
  return wave;
};

const noiseFor = (c: BaseAudioContext, short: boolean): AudioBuffer => {
  const byMode = noises.get(c) ?? new Map<boolean, AudioBuffer>();
  noises.set(c, byMode);
  const cached = byMode.get(short);
  if (cached) return cached;
  const length = Math.floor(c.sampleRate);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  // Long mode clocks at about 22 kHz for a snare's body; short mode at the sample rate.
  buffer.getChannelData(0).set(lfsrNoise(length, short, short ? 1 : 2));
  byMode.set(short, buffer);
  return buffer;
};

const ATTACK = 0.003;

/**
 * Hard on, hold, then the console's stepped fade: 15 volume steps to silence
 * over `release` seconds. Returns the end time.
 */
const gate = (g: AudioParam, t0: number, hold: number, peak: number, release: number): number => {
  const off = t0 + Math.max(hold, ATTACK);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + ATTACK);
  g.setValueAtTime(peak, off);
  for (let i = 1; i <= 15; i++) g.setValueAtTime((peak * (15 - i)) / 15, off + (release * i) / 15);
  return off + release;
};

/** Delayed sine vibrato on an oscillator; `base` is its resting depth as a share of the pitch. */
const vibrato = (c: BaseAudioContext, o: OscillatorNode, f: number, t0: number, base: number) => {
  const lfo = c.createOscillator();
  lfo.frequency.value = 6;
  const depth = c.createGain();
  depth.gain.setValueAtTime(0, t0);
  depth.gain.linearRampToValueAtTime(0, t0 + 0.25);
  depth.gain.linearRampToValueAtTime(f * base, t0 + 0.4);
  lfo.connect(depth).connect(o.frequency);
  const wobble = (amount: number, now: number) => depth.gain.setTargetAtTime(f * (base + amount * 0.016), now, 0.05);
  return { lfo, depth, wobble };
};

/** Pulse lead: 12.5 percent is thin and nasal, 25 the classic lead, 50 a hollow square. */
export const pulse = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number, duty: Duty = 0.25): ChipBuilt => {
  const release = 0.08;
  const o = c.createOscillator();
  o.setPeriodicWave(waveFor(c, `pulse-${duty}`, dutyLevels(duty)));
  o.frequency.value = f;
  const vca = c.createGain();
  const end = gate(vca.gain, t0, hold, peak * 0.32, release);
  o.connect(vca).connect(dest);
  const vib = vibrato(c, o, f, t0, 0.004);
  return { sources: [o, vib.lfo], nodes: [vca, vib.depth], wobble: vib.wobble, release, end };
};

/** Triangle bass: no volume control on the real chip, so it is simply on, then off. */
export const triangle = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number): ChipBuilt => {
  const release = 0.03;
  const o = c.createOscillator();
  o.setPeriodicWave(waveFor(c, 'triangle', TRIANGLE_LEVELS));
  o.frequency.value = f;
  const vca = c.createGain();
  const end = gate(vca.gain, t0, hold, peak * 0.6, release);
  o.connect(vca).connect(dest);
  // No resting vibrato; the wiggle gesture still bends it.
  const vib = vibrato(c, o, f, t0, 0);
  return { sources: [o, vib.lfo], nodes: [vca, vib.depth], wobble: vib.wobble, release, end };
};

export type DrumPiece = 'kick' | 'snare' | 'hat' | 'open-hat';

/** General MIDI drum numbers to kit pieces: 35 and 36 kick, 37 to 40 snare, 46 open hat, other notes closed hat. */
export const drumFor = (midi: number): DrumPiece => (midi <= 36 ? 'kick' : midi <= 40 ? 'snare' : midi === 46 ? 'open-hat' : 'hat');

const midiOf = (f: number): number => Math.round(69 + 12 * Math.log2(f / 440));

/** Exponential fall from `peak` to silence over `seconds`. */
const decay = (g: AudioParam, t0: number, peak: number, seconds: number): number => {
  g.setValueAtTime(0.0001, t0);
  g.linearRampToValueAtTime(peak, t0 + 0.002);
  g.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  return t0 + seconds;
};

/**
 * Noise channel drum kit, one hit per note, picked by pitch (see drumFor).
 * Hits are one-shots: `hold` is accepted for the common signature and ignored.
 */
export const drum = (c: BaseAudioContext, dest: AudioNode, f: number, t0: number, _hold: number, peak: number): ChipBuilt => {
  const piece = drumFor(midiOf(f));
  const silent = () => {};
  if (piece === 'kick') {
    // A sine swept down fast: the thump, then the boom.
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12);
    const vca = c.createGain();
    const end = decay(vca.gain, t0, peak * 0.9, 0.28);
    o.connect(vca).connect(dest);
    return { sources: [o], nodes: [vca], wobble: silent, release: 0.05, end };
  }
  if (piece === 'snare') {
    // Band-passed long-mode noise, with a short falling tone for the drum's body.
    const n = c.createBufferSource();
    n.buffer = noiseFor(c, false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const nv = c.createGain();
    const end = decay(nv.gain, t0, peak * 0.55, 0.18);
    n.connect(bp).connect(nv).connect(dest);
    const body = c.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, t0);
    body.frequency.exponentialRampToValueAtTime(120, t0 + 0.05);
    const bv = c.createGain();
    decay(bv.gain, t0, peak * 0.4, 0.08);
    body.connect(bv).connect(dest);
    return { sources: [n, body], nodes: [bp, nv, bv], wobble: silent, release: 0.05, end };
  }
  // Hats: high-passed short-mode noise, closed or open.
  const n = c.createBufferSource();
  n.buffer = noiseFor(c, true);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  hp.Q.value = 0.7;
  const vca = c.createGain();
  const end = decay(vca.gain, t0, peak * 0.3, piece === 'open-hat' ? 0.3 : 0.05);
  n.connect(hp).connect(vca).connect(dest);
  return { sources: [n], nodes: [hp, vca], wobble: silent, release: 0.03, end };
};

/**
 * One tap, a whole chord: a single pulse voice flicking through the chord's
 * notes every `step` seconds (two frames at 60 Hz by default), the classic
 * console trick for harmony on one channel. `intervals` are semitones above `f`.
 */
export const arpeggio = (
  c: BaseAudioContext,
  dest: AudioNode,
  f: number,
  t0: number,
  hold: number,
  peak: number,
  intervals: readonly number[] = [0, 4, 7],
  step = 1 / 30,
  duty: Duty = 0.25,
): ChipBuilt => {
  const release = 0.08;
  const o = c.createOscillator();
  o.setPeriodicWave(waveFor(c, `pulse-${duty}`, dutyLevels(duty)));
  const vca = c.createGain();
  const end = gate(vca.gain, t0, hold, peak * 0.3, release);
  const notes = intervals.length > 0 ? intervals : [0];
  const count = Math.max(1, Math.ceil((end - t0) / step));
  for (let i = 0; i < count; i++) o.frequency.setValueAtTime(f * 2 ** ((notes[i % notes.length] ?? 0) / 12), t0 + i * step);
  o.connect(vca).connect(dest);
  return { sources: [o], nodes: [vca], wobble: () => {}, release, end };
};
