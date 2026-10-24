import type { InstrumentId } from '@kilukkam/shared';

// Real recorded instruments (VSCO 2 CE, CC0; see public/samples/CREDITS.md).
// One recording every few semitones; the player pitch-shifts the nearest one.
// Pure data and maths only, so it is unit tested without WebAudio.

/**
 * A bank is one articulation of one instrument: sustained with vibrato, short
 * strokes (spiccato / staccato) or soft. Each lives in public/samples/<bank>/<midi>.m4a.
 */
export type BankId = InstrumentId | 'violin-short' | 'violin-soft' | 'cello-short' | 'flute-short';

export const BANK_NOTES: Record<BankId, readonly number[]> = {
  violin: [55, 60, 64, 67, 72, 76, 79, 84, 88],
  'violin-short': [55, 60, 64, 67, 69, 72, 76, 79, 81, 84],
  'violin-soft': [55, 60, 64, 67, 72, 76, 79, 84, 88],
  cello: [35, 38, 41, 45, 48, 52, 55, 59, 62],
  'cello-short': [35, 38, 41, 45, 48, 52, 55, 59, 62],
  flute: [60, 64, 69, 72, 76, 81, 84],
  'flute-short': [60, 64, 69, 72, 76, 81, 84],
  piano: [37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85],
  // Drums and guitar are synthesised (see audio.ts): no recordings to fetch.
  drums: [],
  guitar: [],
};

/** Every bank an instrument can draw on, main (sustained) first. */
export const BANKS_FOR: Record<InstrumentId, readonly BankId[]> = {
  violin: ['violin', 'violin-short', 'violin-soft'],
  cello: ['cello', 'cello-short'],
  flute: ['flute', 'flute-short'],
  piano: ['piano'],
  drums: [],
  guitar: [],
};

/** Notes written shorter than this (seconds) get a short stroke when one is recorded */
export const SHORT_NOTE = 0.34;
/** Velocities below this use the soft recording when one exists */
export const SOFT_VELOCITY = 64;

/** Which recording suits this note: a quick note gets a short stroke, a gentle one the soft take. */
export const pickBank = (instrument: InstrumentId, seconds: number, velocity: number, held: boolean, has: (b: BankId) => boolean): BankId => {
  const short = `${instrument}-short` as BankId;
  const soft = `${instrument}-soft` as BankId;
  if (!held && seconds < SHORT_NOTE && short in BANK_NOTES && has(short)) return short;
  if (velocity < SOFT_VELOCITY && soft in BANK_NOTES && has(soft)) return soft;
  return instrument;
};

/** Each instrument's tone colour and seat on the stage (pan only applies when mixing, e.g. recordings). */
export interface Tone {
  pan: number;
  low: { freq: number; gain: number };
  high: { freq: number; gain: number };
}

export const TONE: Record<InstrumentId, Tone> = {
  violin: { pan: -0.45, low: { freq: 250, gain: -3 }, high: { freq: 3500, gain: 2.5 } },
  flute: { pan: -0.15, low: { freq: 320, gain: -4 }, high: { freq: 2600, gain: 1.5 } },
  piano: { pan: 0.2, low: { freq: 120, gain: 1 }, high: { freq: 4000, gain: 0.5 } },
  cello: { pan: 0.45, low: { freq: 140, gain: 3 }, high: { freq: 3000, gain: -3 } },
  drums: { pan: 0, low: { freq: 100, gain: 2 }, high: { freq: 6000, gain: 1 } },
  guitar: { pan: -0.25, low: { freq: 120, gain: 2 }, high: { freq: 3500, gain: -1 } },
};

export interface SampleShape {
  /** Seconds to fade in; samples carry their own attack, so this only removes clicks */
  attack: number;
  /** Seconds to ring off after the note (or the held finger) ends */
  release: number;
  /** Sustained instruments loop their steady middle when held past the recording */
  loops: boolean;
  /** Overall level so the four instruments balance in a room */
  level: number;
}

export const SHAPES: Record<InstrumentId, SampleShape> = {
  violin: { attack: 0.012, release: 0.35, loops: true, level: 1 },
  cello: { attack: 0.025, release: 0.5, loops: true, level: 1.1 },
  flute: { attack: 0.02, release: 0.25, loops: true, level: 0.95 },
  piano: { attack: 0.002, release: 0.45, loops: false, level: 1.05 },
  drums: { attack: 0.001, release: 0.05, loops: false, level: 1.1 },
  guitar: { attack: 0.001, release: 0.25, loops: false, level: 1.1 },
};

/** Instruments played by a synthesised voice, with no recordings behind them */
export const SYNTHESISED: ReadonlySet<InstrumentId> = new Set(['drums', 'guitar']);

/** Short strokes ring off fast and never loop. */
export const shapeFor = (bank: BankId, instrument: InstrumentId): SampleShape =>
  bank.endsWith('-short') ? { ...SHAPES[instrument], attack: 0.003, release: 0.12, loops: false } : SHAPES[instrument];

export const sampleUrl = (bank: BankId, midi: number): string => `/samples/${bank}/${midi}.m4a`;

/** The recording closest in pitch; on a tie, the lower one (shifting up sounds more natural). */
export const nearestSample = (notes: readonly number[], midi: number): number | undefined =>
  notes.reduce<number | undefined>((best, n) => {
    if (best === undefined) return n;
    const d = Math.abs(n - midi);
    const bd = Math.abs(best - midi);
    return d < bd || (d === bd && n < best) ? n : best;
  }, undefined);

/** playbackRate that turns a recording of `from` into `to`. */
export const rateFor = (from: number, to: number): number => 2 ** ((to - from) / 12);

/** Where a held note loops inside a recording of `duration` seconds: the steady middle. */
export const loopRegion = (duration: number): { start: number; end: number } | null => {
  if (duration < 1.2) return null;
  return { start: Math.min(1.2, duration * 0.3), end: duration - 0.45 };
};
