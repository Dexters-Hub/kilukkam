import { describe, expect, it } from 'vitest';
import {
  type BeatFit,
  OnsetDetector,
  type Onset,
  fitAtTempo,
  fitBeat,
  foldTempo,
  fuse,
  phaseOf,
  stabilise,
  tapTempo,
  toEstimate,
} from '../src/lib/beat/detect.js';
import { captureTimeMs, hintFrom } from '../src/lib/beat/capture.js';

const SR = 44_100;
/** The detector's timeline starts somewhere arbitrary, like a real epoch clock */
const T0 = 1_700_000_000_000;

/** Deterministic noise so the synthetic tracks are the same every run */
const noise = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
};

type Hit = { atMs: number; kind: 'click' | 'kick' | 'snare' | 'hat' };

/** Render hits into mono audio over a quiet floor (and an optional sustained pad). */
const render = (hits: readonly Hit[], seconds: number, pad = 0): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  const rnd = noise(7);
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 0.002 + pad * Math.sin((2 * Math.PI * 220 * i) / SR);
  for (const h of hits) {
    const start = Math.round((h.atMs / 1000) * SR);
    const len = { click: 0.004, kick: 0.12, snare: 0.08, hat: 0.02 }[h.kind] * SR;
    for (let j = 0; j < len && start + j < out.length; j++) {
      const env = Math.exp(-j / (len / 4));
      const v =
        h.kind === 'click'
          ? 0.6 * Math.sin((2 * Math.PI * 2000 * j) / SR)
          : h.kind === 'kick'
            ? 0.8 * Math.sin((2 * Math.PI * 60 * j) / SR)
            : h.kind === 'snare'
              ? 0.5 * rnd() * 2
              : 0.15 * rnd() * 2;
      out[start + j] = (out[start + j] ?? 0) + v * env;
    }
  }
  return out;
};

/** Run audio through the detector in 1024 sample blocks, as the capture worklet delivers it. */
const detect = (audio: Float32Array): Onset[] => {
  const d = new OnsetDetector({ sampleRate: SR });
  const onsets: Onset[] = [];
  for (let i = 0; i < audio.length; i += 1024) onsets.push(...d.push(audio.subarray(i, i + 1024), T0 + (i / SR) * 1000));
  return onsets;
};

const clicks = (bpm: number, firstMs: number, seconds: number): Hit[] => {
  const p = 60_000 / bpm;
  const hits: Hit[] = [];
  for (let t = firstMs; t < seconds * 1000; t += p) hits.push({ atMs: t, kind: 'click' });
  return hits;
};

/** How far (ms) the fitted grid's nearest beat is from a true beat time. */
const phaseErrorMs = (fit: BeatFit, trueBeatMs: number): number => {
  const ph = phaseOf(fit, trueBeatMs);
  return Math.min(ph, 1 - ph) * fit.periodMs;
};

describe('OnsetDetector', () => {
  it('finds each click once, within a few ms', () => {
    const hits = clicks(120, 250, 4);
    const onsets = detect(render(hits, 4));
    expect(onsets).toHaveLength(hits.length);
    onsets.forEach((o, i) => expect(Math.abs(o.t - (T0 + (hits[i]?.atMs ?? 0)))).toBeLessThan(6));
  });

  it('stays quiet on a noise floor and on a steady tone', () => {
    expect(detect(render([], 3))).toHaveLength(0);
    expect(detect(render([], 3, 0.2))).toHaveLength(0);
  });

  it('gives the same onsets whatever the block size', () => {
    const audio = render(clicks(100, 80, 3), 3);
    const whole = new OnsetDetector({ sampleRate: SR }).push(audio, T0);
    expect(whole.map((o) => Math.round(o.t))).toEqual(detect(audio).map((o) => Math.round(o.t)));
  });
});

describe('fitBeat on click tracks', () => {
  for (const bpm of [90, 120, 128]) {
    it(`locks to ${bpm} bpm within 2 bpm and 40 ms of phase`, () => {
      const first = 333;
      const fit = fitBeat(detect(render(clicks(bpm, first, 12), 12)));
      expect(fit).not.toBeNull();
      if (!fit) return;
      expect(Math.abs(fit.bpm - bpm)).toBeLessThanOrEqual(2);
      expect(phaseErrorMs(fit, T0 + first)).toBeLessThanOrEqual(40);
      expect(fit.confidence).toBeGreaterThan(0.9);
    });
  }

  it('finds the beat in a drum groove, not the hat eighths or the kick half time', () => {
    const bpm = 120;
    const p = 60_000 / bpm;
    const hits: Hit[] = [];
    for (let beat = 0; beat < 24; beat++) {
      const t = 150 + beat * p;
      hits.push({ atMs: t, kind: beat % 2 === 0 ? 'kick' : 'snare' });
      hits.push({ atMs: t + p / 2, kind: 'hat' });
    }
    const fit = fitBeat(detect(render(hits, 12, 0.05)));
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(Math.abs(fit.bpm - bpm)).toBeLessThanOrEqual(2);
    expect(phaseErrorMs(fit, T0 + 150)).toBeLessThanOrEqual(40);
  });

  it('survives timing jitter and missed hits', () => {
    const rnd = noise(3);
    const bpm = 128;
    const hits = clicks(bpm, 200, 12)
      .filter((_, i) => i % 7 !== 3)
      .map((h) => ({ ...h, atMs: h.atMs + rnd() * 20 }));
    const fit = fitBeat(detect(render(hits, 12)));
    expect(fit && Math.abs(fit.bpm - bpm)).toBeLessThanOrEqual(2);
    if (fit) expect(phaseErrorMs(fit, T0 + 200)).toBeLessThanOrEqual(40);
  });

  it('waits for enough onsets', () => {
    expect(fitBeat([])).toBeNull();
    expect(fitBeat([{ t: 0, strength: 5 }, { t: 500, strength: 5 }])).toBeNull();
  });

  it('scores a random scatter low', () => {
    const rnd = noise(11);
    const onsets = Array.from({ length: 30 }, (_, i) => ({ t: i * 400 + rnd() * 380, strength: 5 }));
    expect(fitBeat(onsets)?.confidence ?? 0).toBeLessThan(0.6);
  });
});

describe('tempo helpers', () => {
  it('folds tempos into one octave', () => {
    expect(foldTempo(60)).toBe(120);
    expect(foldTempo(256)).toBe(128);
    expect(foldTempo(90)).toBe(90);
  });

  const grid = (bpm: number, n: number): Onset[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (i * 60_000) / bpm, strength: 4 }));

  it('raises confidence when the library agrees', () => {
    const onsets = grid(120, 16);
    const own = fitBeat(onsets);
    const fused = fuse(onsets, own, { bpm: 60.2, confidence: 0.6 });
    expect(fused?.bpm).toBeCloseTo(own?.bpm ?? 0, 5);
    expect(fused?.confidence ?? 0).toBeGreaterThanOrEqual(own?.confidence ?? 1);
  });

  it('prefers whichever tempo the onsets fit when they disagree', () => {
    const onsets = grid(100, 20);
    const wrongOwn: BeatFit = { bpm: 133, periodMs: 60_000 / 133, anchorMs: T0, confidence: 0.2 };
    const fused = fuse(onsets, wrongOwn, { bpm: 100, confidence: 0.8 });
    expect(fused?.bpm).toBeCloseTo(100, 5);
    expect(fuse(onsets, wrongOwn, null)).toBe(wrongOwn);
    expect(fuse(onsets, null, { bpm: 100, confidence: 0.8 })?.bpm).toBeCloseTo(100, 5);
  });

  it('holds the published tempo through small jitter and refits the phase there', () => {
    const onsets = grid(121.5, 16);
    const fit = fitBeat(onsets);
    if (!fit) throw new Error('no fit');
    const held = stabilise(onsets, fit, 120);
    expect(held.bpm).toBe(120);
    expect(stabilise(onsets, fit, 110).bpm).toBeCloseTo(fit.bpm, 5);
    expect(stabilise(onsets, fit, null)).toBe(fit);
    expect(fitAtTempo(onsets, 120)?.bpm).toBe(120);
  });

  it('maps a fit onto server time', () => {
    const fit: BeatFit = { bpm: 120, periodMs: 500, anchorMs: 10_000, confidence: 0.9 };
    const est = toEstimate(fit, 2_000, 'mic');
    expect(est.anchorServerMs).toBe(12_000);
    expect(est.beatPhaseAt(12_000)).toBeCloseTo(0, 9);
    expect(est.beatPhaseAt(12_250)).toBeCloseTo(0.5, 9);
    expect(est.beatPhaseAt(11_875)).toBeCloseTo(0.75, 9);
  });
});

describe('tapTempo', () => {
  it('needs four taps', () => {
    expect(tapTempo([0, 500, 1000])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])?.bpm).toBeCloseTo(120, 6);
  });

  it('is accurate with human jitter and puts the phase on the taps', () => {
    const rnd = noise(5);
    const taps = Array.from({ length: 8 }, (_, i) => T0 + i * 468.75 + rnd() * 30);
    const fit = tapTempo(taps);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(Math.abs(fit.bpm - 128)).toBeLessThanOrEqual(2);
    expect(phaseErrorMs(fit, T0)).toBeLessThanOrEqual(40);
    expect(fit.confidence).toBeGreaterThan(0.7);
  });

  it('starts over after a long pause and uses only the latest taps', () => {
    const old = [0, 1000, 2000, 3000];
    const fresh = [10_000, 10_500, 11_000, 11_500, 12_000];
    expect(tapTempo([...old, ...fresh])?.bpm).toBeCloseTo(120, 6);
    const drifting = [0, 600, 1200, 1800, 2300, 2800, 3300, 3800];
    expect(tapTempo(drifting, { maxTaps: 4 })?.bpm).toBeCloseTo(120, 6);
  });

  it('reports low confidence for erratic taps', () => {
    expect(tapTempo([0, 300, 1000, 1200, 2000, 2150])?.confidence ?? 0).toBeLessThan(0.4);
  });
});

describe('mic helpers', () => {
  it('takes the library\'s strongest candidate as the hint', () => {
    expect(hintFrom({ bpm: [{ tempo: 124, count: 9, confidence: 0.7 }], threshold: 0.3 })).toEqual({ bpm: 124, confidence: 0.7 });
    expect(hintFrom({ bpm: [], threshold: 0.3 })).toBeNull();
    expect(hintFrom({ bpm: [{ tempo: 90, count: 3, confidence: 4 }], threshold: 0.3 })?.confidence).toBe(1);
  });

  it('maps a captured frame back to when the sound reached the microphone', () => {
    // Context second 10 is heard at performance ms 5000; output runs 20 ms behind rendering; input adds 15 ms.
    const t = captureTimeMs({
      frameSeconds: 10.5,
      stamp: { contextTime: 10, performanceTime: 5000 },
      timeOrigin: T0,
      outputLatencySeconds: 0.02,
      inputLatencyMs: 15,
    });
    expect(t).toBeCloseTo(T0 + 5000 + 500 - 20 - 15, 6);
  });
});
