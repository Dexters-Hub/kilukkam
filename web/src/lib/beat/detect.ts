import { steadyTempo } from '../baton.js';

// Design note: beat from sound, because Spotify gives us no tempo.
//
// Spotify closed audio features and audio analysis to new apps, and its
// stream is DRM protected, so neither the API nor WebAudio can tell us where
// the beat is. The conductor laptop's microphone hears the same speaker as
// the room, so we detect the beat acoustically. Everything here is pure maths
// over samples and timestamps (no WebAudio), so it is unit tested with
// synthetic click tracks; lib/beat/mic.ts only wires the microphone in.
//
// 1. Onsets: energy flux. The signal is cut into 5 ms hops; each hop's energy
//    in dB is compared with the hop before. A beat is a sudden rise, so the
//    positive dB jump (the flux) spikes at drum hits. A hop is an onset when
//    its flux clears an adaptive threshold (mean plus k standard deviations of
//    the last second of flux, never below a fixed floor) and the hop is not
//    silent, with a refractory gap so one hit is one onset.
// 2. Tempo and phase together: phase coherence. For a candidate period P,
//    each onset at time t becomes the unit vector at angle 2 pi t / P. If the
//    onsets sit on a grid of period P the vectors line up and their weighted
//    mean has length near 1; otherwise they cancel. The best P is the tempo,
//    the mean's angle is the beat phase, and its length is the confidence.
//    Onsets are weighted by strength and by recency (8 s half-life), so the
//    fit follows a song that drifts or changes. Halving the period also lines
//    every onset up, so candidates are limited to one octave (80 to 160 bpm
//    by default) with a mild tempo prior centred on 120 to settle ties.
// 3. Fusion: the realtime-bpm-analyzer library's tempo is a second opinion.
//    When they agree, confidence rises; when they disagree, the tempo whose
//    grid the onsets fit better wins, at reduced confidence.
// 4. Tap tempo: the conductor taps four or more times; a least squares line
//    through the taps gives the period and the phase, with the residual
//    spread as confidence. It is the fallback when the room is too loud or
//    the song too soft for the microphone.
// 5. Stability: the published tempo goes through steadyTempo (baton.ts), so
//    jitter under 3 bpm never moves the room, and the phase is then refitted
//    at the published tempo so the two always agree.

export interface Onset {
  /** ms on the caller's timeline */
  t: number;
  /** Flux in dB above the threshold: how hard the hit was */
  strength: number;
}

export interface OnsetOptions {
  sampleRate: number;
  hopMs?: number;
  /** Threshold = mean + sensitivity * std of recent flux */
  sensitivity?: number;
  historyMs?: number;
  refractoryMs?: number;
  /** A jump smaller than this (dB) is never an onset */
  minFluxDb?: number;
  /** Hops quieter than this (dBFS) are treated as silence */
  silenceDb?: number;
}

const EPS = 1e-10;

/** Streaming energy flux onset detector. Feed it consecutive blocks of mono samples. */
export class OnsetDetector {
  private readonly hop: number;
  private readonly hopMs: number;
  private readonly sensitivity: number;
  private readonly historyLen: number;
  private readonly refractoryMs: number;
  private readonly minFluxDb: number;
  private readonly silenceDb: number;
  private readonly sampleMs: number;

  private acc = 0;
  private count = 0;
  /** Timeline ms of the first sample in the current hop */
  private hopStart = 0;
  private prevDb: number | null = null;
  private history: number[] = [];
  private lastOnset = -Infinity;

  constructor(opts: OnsetOptions) {
    this.hopMs = opts.hopMs ?? 5;
    this.hop = Math.max(1, Math.round((opts.sampleRate * this.hopMs) / 1000));
    this.sampleMs = 1000 / opts.sampleRate;
    this.sensitivity = opts.sensitivity ?? 2;
    this.historyLen = Math.max(8, Math.round((opts.historyMs ?? 1000) / this.hopMs));
    this.refractoryMs = opts.refractoryMs ?? 100;
    this.minFluxDb = opts.minFluxDb ?? 6;
    this.silenceDb = opts.silenceDb ?? -60;
  }

  /** `startMs` is the timeline time of `samples[0]`. Returns the onsets that completed in this block. */
  push(samples: Float32Array, startMs: number): Onset[] {
    const found: Onset[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (this.count === 0) this.hopStart = startMs + i * this.sampleMs;
      const s = samples[i] ?? 0;
      this.acc += s * s;
      this.count++;
      if (this.count === this.hop) {
        const onset = this.endHop();
        if (onset) found.push(onset);
      }
    }
    return found;
  }

  reset(): void {
    this.acc = 0;
    this.count = 0;
    this.prevDb = null;
    this.history = [];
    this.lastOnset = -Infinity;
  }

  private endHop(): Onset | null {
    const db = 10 * Math.log10(this.acc / this.count + EPS);
    // Centre of the hop: a hit starting anywhere inside it is at most half a hop away.
    const t = this.hopStart + this.hopMs / 2;
    this.acc = 0;
    this.count = 0;
    const prev = this.prevDb;
    this.prevDb = db;
    if (prev === null) return null;
    const flux = Math.max(0, db - prev);

    const h = this.history;
    const mean = h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
    const std = h.length ? Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length) : 0;
    h.push(flux);
    if (h.length > this.historyLen) h.shift();

    const threshold = Math.max(this.minFluxDb, mean + this.sensitivity * std);
    if (flux < threshold || db < this.silenceDb || t - this.lastOnset < this.refractoryMs) return null;
    this.lastOnset = t;
    return { t, strength: flux - threshold + 1 };
  }
}

/** A beat grid: beats fall at anchorMs + k * periodMs. */
export interface BeatFit {
  bpm: number;
  periodMs: number;
  anchorMs: number;
  /** 0 to 1 */
  confidence: number;
}

/** Where `t` falls between beats: 0 on the beat, 0.5 halfway, always in [0, 1). */
export const phaseOf = (fit: Pick<BeatFit, 'periodMs' | 'anchorMs'>, t: number): number => {
  const p = (t - fit.anchorMs) / fit.periodMs;
  return p - Math.floor(p);
};

export interface FitOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Only onsets this recent (relative to the newest) count */
  windowMs?: number;
  halfLifeMs?: number;
  /** Fewer onsets than this is not a beat yet */
  minOnsets?: number;
}

interface Weighted {
  t: number;
  w: number;
}

const DEFAULT_FIT = { minBpm: 80, maxBpm: 160, windowMs: 12_000, halfLifeMs: 8_000, minOnsets: 6 } as const;

const weigh = (onsets: readonly Onset[], o: Required<FitOptions>): Weighted[] => {
  const last = onsets[onsets.length - 1];
  if (!last) return [];
  return onsets
    .filter((x) => last.t - x.t <= o.windowMs)
    .map((x) => ({ t: x.t - last.t, w: Math.sqrt(Math.max(0, x.strength)) * 2 ** ((x.t - last.t) / o.halfLifeMs) }));
};

/** Coherence of the onsets with a grid of period P (relative times), and where that grid puts a beat. */
const coherence = (pts: readonly Weighted[], periodMs: number): { c: number; offset: number } => {
  let re = 0;
  let im = 0;
  let total = 0;
  for (const { t, w } of pts) {
    const a = (2 * Math.PI * t) / periodMs;
    re += w * Math.cos(a);
    im += w * Math.sin(a);
    total += w;
  }
  if (total <= 0) return { c: 0, offset: 0 };
  return { c: Math.hypot(re, im) / total, offset: (Math.atan2(im, re) / (2 * Math.PI)) * periodMs };
};

/** Log-normal tempo prior around 120 bpm, one octave wide: only breaks near ties. */
const prior = (bpm: number): number => Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);

/** Bring a tempo into [min, max) by octaves. */
export const foldTempo = (bpm: number, min: number = DEFAULT_FIT.minBpm, max: number = DEFAULT_FIT.maxBpm): number => {
  if (!(bpm > 0)) return bpm;
  let b = bpm;
  while (b < min) b *= 2;
  while (b >= max) b /= 2;
  return b;
};

const resolve = (opts: FitOptions): Required<FitOptions> => ({ ...DEFAULT_FIT, ...opts });

/** Fit a beat grid with the tempo fixed (a tap, the library, or the published tempo). */
export const fitAtTempo = (onsets: readonly Onset[], bpm: number, opts: FitOptions = {}): BeatFit | null => {
  const o = resolve(opts);
  const pts = weigh(onsets, o);
  const last = onsets[onsets.length - 1];
  if (!last || pts.length < o.minOnsets || !(bpm > 0)) return null;
  const periodMs = 60_000 / bpm;
  const { c, offset } = coherence(pts, periodMs);
  return { bpm, periodMs, anchorMs: last.t + offset, confidence: c };
};

/** Best tempo and phase for a run of onsets, or null when there are too few. */
export const fitBeat = (onsets: readonly Onset[], opts: FitOptions = {}): BeatFit | null => {
  const o = resolve(opts);
  const pts = weigh(onsets, o);
  const last = onsets[onsets.length - 1];
  if (!last || pts.length < o.minOnsets) return null;
  const search = (from: number, to: number, step: number): { bpm: number; score: number } => {
    let best = { bpm: from, score: -1 };
    for (let bpm = from; bpm <= to + 1e-9; bpm += step) {
      const score = coherence(pts, 60_000 / bpm).c * prior(bpm);
      if (score > best.score) best = { bpm, score };
    }
    return best;
  };
  const coarse = search(o.minBpm, o.maxBpm - 0.25, 0.25);
  const fine = search(Math.max(o.minBpm, coarse.bpm - 0.3), Math.min(o.maxBpm, coarse.bpm + 0.3), 0.01);
  return fitAtTempo(onsets, fine.bpm, o);
};

/** The analyzer library's view: a tempo and how sure it is (0 to 1). */
export interface TempoHint {
  bpm: number;
  confidence: number;
}

/** Tempos within this fraction are the same tempo */
const AGREE = 0.03;
/** Ignore library opinions weaker than this */
const MIN_HINT = 0.25;

/** Combine our onset fit with the library's tempo. See the design note, step 3. */
export const fuse = (onsets: readonly Onset[], own: BeatFit | null, hint: TempoHint | null, opts: FitOptions = {}): BeatFit | null => {
  const o = resolve(opts);
  if (!hint || hint.confidence < MIN_HINT || !(hint.bpm > 0)) return own;
  const hinted = fitAtTempo(onsets, foldTempo(hint.bpm, o.minBpm, o.maxBpm), o);
  if (!own) return hinted ? { ...hinted, confidence: hinted.confidence * hint.confidence } : null;
  if (!hinted) return own;
  if (Math.abs(own.bpm - hinted.bpm) / hinted.bpm <= AGREE) {
    return { ...own, confidence: 1 - (1 - own.confidence) * (1 - hint.confidence) };
  }
  const winner = hinted.confidence > own.confidence ? hinted : own;
  return { ...winner, confidence: winner.confidence * 0.75 };
};

/**
 * Publish a new fit against the tempo the room already plays: the tempo only
 * moves for changes of 3 bpm or more (steadyTempo), and the phase is refitted
 * at whichever tempo is published.
 */
export const stabilise = (onsets: readonly Onset[], fit: BeatFit, publishedBpm: number | null, opts: FitOptions = {}): BeatFit => {
  if (publishedBpm === null) return fit;
  const bpm = steadyTempo(publishedBpm, fit.bpm);
  if (bpm === fit.bpm) return fit;
  const refit = fitAtTempo(onsets, bpm, opts);
  return refit ? { ...refit, confidence: Math.min(refit.confidence, fit.confidence) } : fit;
};

export interface TapOptions {
  /** A pause longer than this starts a new run of taps */
  maxGapMs?: number;
  minTaps?: number;
  /** Only the latest taps count, so the tempo can be corrected by tapping on */
  maxTaps?: number;
}

/** Tap tempo: a least squares beat grid through the latest run of 4 or more taps (ms). */
export const tapTempo = (taps: readonly number[], opts: TapOptions = {}): BeatFit | null => {
  const maxGapMs = opts.maxGapMs ?? 2000;
  const minTaps = Math.max(2, opts.minTaps ?? 4);
  const maxTaps = opts.maxTaps ?? 12;
  let start = 0;
  for (let i = 1; i < taps.length; i++) {
    const gap = (taps[i] ?? 0) - (taps[i - 1] ?? 0);
    if (gap > maxGapMs || gap <= 0) start = i;
  }
  const run = taps.slice(Math.max(start, taps.length - maxTaps));
  const n = run.length;
  if (n < minTaps) return null;
  const meanI = (n - 1) / 2;
  const meanT = run.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varI = 0;
  run.forEach((t, i) => {
    cov += (i - meanI) * (t - meanT);
    varI += (i - meanI) ** 2;
  });
  const periodMs = cov / varI;
  const bpm = 60_000 / periodMs;
  if (!(bpm >= 30 && bpm <= 300)) return null;
  const intercept = meanT - periodMs * meanI;
  const rms = Math.sqrt(run.reduce((a, t, i) => a + (t - (intercept + periodMs * i)) ** 2, 0) / n);
  // Spread of a quarter beat or more is no confidence at all.
  const confidence = Math.max(0, 1 - rms / (periodMs / 4));
  return { bpm, periodMs, anchorMs: intercept + periodMs * (n - 1), confidence };
};

/** What the rest of the app reads: tempo, confidence and the beat phase at any server time. */
export interface BeatEstimate {
  bpm: number;
  confidence: number;
  /** Server ms of one beat; every other beat is a whole period away */
  anchorServerMs: number;
  periodMs: number;
  source: 'mic' | 'tap';
  /** 0 on the beat, rising to 1 just before the next */
  beatPhaseAt(serverMs: number): number;
}

/** Move a fit from the local timeline to server time (`serverOffsetMs` = server minus local). */
export const toEstimate = (fit: BeatFit, serverOffsetMs: number, source: BeatEstimate['source']): BeatEstimate => {
  const anchorServerMs = fit.anchorMs + serverOffsetMs;
  const grid = { anchorMs: anchorServerMs, periodMs: fit.periodMs };
  return {
    bpm: fit.bpm,
    confidence: fit.confidence,
    anchorServerMs,
    periodMs: fit.periodMs,
    source,
    beatPhaseAt: (serverMs) => phaseOf(grid, serverMs),
  };
};
