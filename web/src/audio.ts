import type { InstrumentId } from '@kilukkam/shared';
import { beatsToSeconds, midiToFreq } from './music.js';

// WebAudio synth voices, no samples. Each tap builds a short-lived node
// graph that disconnects itself when the note ends.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;

type Ctor = typeof AudioContext;

function audioCtor(): Ctor | undefined {
  const w = window as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Create or resume the AudioContext. Must run inside a user gesture
 * (pointerdown/click) the first time or iOS keeps it suspended.
 */
export function unlockAudio(): AudioContext | null {
  if (!ctx) {
    const C = audioCtor();
    if (!C) return null;
    ctx = new C({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(comp).connect(ctx.destination);
    // iOS: a silent buffer played in the gesture fully unlocks output.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function audioReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 1.5);
    noise = c.createBuffer(1, len, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

interface Envelope {
  attack: number;
  sustain: number;
  release: number;
}

/** Linear attack to peak, hold at sustain level, exponential release. */
function envelope(g: AudioParam, t0: number, hold: number, peak: number, env: Envelope): number {
  const end = t0 + Math.max(hold, env.attack) + env.release;
  g.setValueAtTime(0.0001, t0);
  g.linearRampToValueAtTime(peak, t0 + env.attack);
  g.setTargetAtTime(peak * env.sustain, t0 + env.attack, 0.08);
  g.setValueAtTime(peak * env.sustain, t0 + Math.max(hold, env.attack));
  g.exponentialRampToValueAtTime(0.0001, end);
  return end;
}

/** Sine LFO on oscillator frequency, faded in after `delay` like a player's vibrato. */
function vibrato(c: AudioContext, targets: OscillatorNode[], t0: number, end: number, rate: number, depthHz: number, delay: number): void {
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
}

function cleanup(last: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  last.onended = () => {
    for (const n of nodes) n.disconnect();
  };
}

function bowed(c: AudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number, dark: boolean): void {
  const env: Envelope = dark
    ? { attack: 0.12, sustain: 0.75, release: 0.6 }
    : { attack: 0.07, sustain: 0.7, release: 0.28 };
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

  vibrato(c, [a, b], t0, end, dark ? 4.8 : 5.6, f * (dark ? 0.004 : 0.006), 0.18);
  a.start(t0);
  b.start(t0);
  a.stop(end);
  b.stop(end);
  cleanup(b, [a, b, mix, lp, vca]);
}

function flute(c: AudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number): void {
  const env: Envelope = { attack: 0.06, sustain: 0.8, release: 0.18 };
  const vca = c.createGain();
  const end = envelope(vca.gain, t0, hold, peak, env);

  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  const h = c.createOscillator();
  h.type = 'sine';
  h.frequency.value = f * 2;
  const hg = c.createGain();
  hg.gain.value = 0.12;
  o.connect(vca);
  h.connect(hg).connect(vca);
  vca.connect(dest);
  vibrato(c, [o, h], t0, end, 4.6, f * 0.004, 0.22);

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

  for (const s of [o, h, n]) {
    s.start(t0);
    s.stop(end);
  }
  cleanup(o, [o, h, hg, vca, n, bp, ng]);
}

function piano(c: AudioContext, dest: AudioNode, f: number, t0: number, hold: number, peak: number): void {
  // Percussive: near-instant attack, decay that shortens up the keyboard.
  const decay = Math.min(2.4, Math.max(0.5, hold + 0.4) * (f > 600 ? 0.7 : 1));
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

  const partials: [number, OscillatorType, number][] = [
    [1, 'triangle', 1],
    [2, 'sine', 0.35],
    [3, 'sine', 0.12],
  ];
  const nodes: AudioNode[] = [vca, lp];
  let last: OscillatorNode | null = null;
  for (const [mult, type, gain] of partials) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    const g = c.createGain();
    g.gain.value = gain;
    o.connect(g).connect(lp);
    o.start(t0);
    o.stop(end);
    nodes.push(o, g);
    last = o;
  }
  lp.connect(vca).connect(dest);
  if (last) cleanup(last, nodes);
}

/**
 * Play one score event on this phone. `beats` and `bpm` come straight
 * from the Score so a half note rings twice as long as a quarter.
 */
export function playNote(instrument: InstrumentId, midi: number, beats: number, bpm: number, velocity = 96): void {
  const c = unlockAudio();
  if (!c || !out) return;
  const f = midiToFreq(midi);
  const t0 = c.currentTime + 0.005;
  const hold = Math.min(4, Math.max(0.12, beatsToSeconds(beats, bpm)));
  const peak = 0.32 * Math.min(1, Math.max(0.1, velocity / 127));
  switch (instrument) {
    case 'violin':
      return bowed(c, out, f, t0, hold, peak, false);
    case 'cello':
      return bowed(c, out, f, t0, hold, peak * 1.15, true);
    case 'flute':
      return flute(c, out, f, t0, hold, peak);
    case 'piano':
      return piano(c, out, f, t0, hold, peak * 1.1);
  }
}

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
  cleanup(o, [o, g]);
}
