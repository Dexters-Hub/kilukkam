import type { InstrumentId, ScoreEvent } from '@kilukkam/shared';
import { onsets } from '../../lib/rhythm.js';

// Which lane every note of a part falls in, and which notes are holds or
// flicks. Pure, so the lanes are the same on every phone and in every test.
// Every part is one line of melody, so a note never shares its onset.

export type LaneCount = 1 | 2 | 4;

/** Semitones either side of the median where the melody's motion, not its pitch, picks the lane */
export const BAND = 2;

/** Two lanes: General MIDI drum keys played with the left hand (kicks and toms) */
export const LEFT_DRUMS: ReadonlySet<number> = new Set([35, 36, 41, 43, 45, 47, 48, 50]);

/** Four lanes: kick, snare and clap, hats, then cymbals, toms and the rest of the kit */
export const drumLane = (key: number): number => {
  if (key === 35 || key === 36) return 0;
  if (key === 37 || key === 38 || key === 39 || key === 40) return 1;
  if (key === 42 || key === 44 || key === 46) return 2;
  return 3;
};

/** The biggest interval, in semitones, that still counts as a step to the next lane */
export const STEP = 2;

/** Rest, in beats, after which a phrase starts again from its pitch's own lane */
export const PHRASE_REST = 1;

const sortedNotes = (events: readonly ScoreEvent[]): number[] =>
  events.flatMap((e) => (e.kind === 'note' ? [e.midi] : [])).sort((a, b) => a - b);

const median = (sorted: readonly number[]): number => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** Pitches at the quarter points of a part's own range (by note count), lowest first */
export const quartiles = (events: readonly ScoreEvent[]): [number, number, number] => {
  const sorted = sortedNotes(events);
  if (!sorted.length) return [0, 0, 0];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number;
  return [at(0.25), at(0.5), at(0.75)];
};

/** The quarter of the range a pitch sits in: 0 lowest to 3 highest */
export const bandOf = (midi: number, [q1, q2, q3]: readonly [number, number, number]): number =>
  midi < q1 ? 0 : midi < q2 ? 1 : midi < q3 ? 2 : 3;

const clamp = (n: number) => Math.max(0, Math.min(3, n));

/**
 * Four lanes for a melody. Each phrase starts in its pitch's quarter of the
 * range; after that the motion decides: a repeated note stays, a step moves to
 * the neighbouring lane in its direction, a leap jumps two lanes or straight to
 * its pitch's quarter if that is further. Against the edge a move bounces
 * back, so a changing pitch never lands in the lane it left.
 */
const fourLanes = (events: readonly ScoreEvent[]): (number | null)[] => {
  const q = quartiles(events);
  let prev: { midi: number; lane: number } | null = null;
  let silence = 0;
  return events.map((e) => {
    if (e.kind !== 'note') {
      silence += e.beats;
      return null;
    }
    const band = bandOf(e.midi, q);
    let lane: number;
    if (!prev) lane = band;
    else if (e.midi === prev.midi) lane = prev.lane;
    else {
      const dir = e.midi > prev.midi ? 1 : -1;
      const leap = Math.abs(e.midi - prev.midi) > STEP;
      if (silence >= PHRASE_REST && band !== prev.lane) lane = band;
      else {
        const far = leap ? (dir > 0 ? Math.max(prev.lane + 2, band) : Math.min(prev.lane - 2, band)) : prev.lane + dir;
        lane = clamp(far);
        if (lane === prev.lane) lane = clamp(prev.lane - dir * (leap ? 2 : 1));
      }
    }
    silence = 0;
    prev = { midi: e.midi, lane };
    return lane;
  });
};

/**
 * Two lanes for a melody: clearly low notes left (0), clearly high ones right
 * (1). Near the median a repeated note keeps its lane and a moving note swaps
 * hands, so a run alternates.
 */
const twoLanes = (events: readonly ScoreEvent[]): (number | null)[] => {
  const sorted = sortedNotes(events);
  const mid = sorted.length ? median(sorted) : 0;
  let prev: { midi: number; lane: number } | null = null;
  return events.map((e) => {
    if (e.kind !== 'note') return null;
    let lane: number;
    if (e.midi > mid + BAND) lane = 1;
    else if (e.midi < mid - BAND) lane = 0;
    else if (prev) lane = e.midi === prev.midi ? prev.lane : 1 - prev.lane;
    else lane = e.midi >= mid ? 1 : 0;
    prev = { midi: e.midi, lane };
    return lane;
  });
};

/** The lane (0 is leftmost) of every event in `events`; null for rests */
export function assignLanes(events: readonly ScoreEvent[], instrument: InstrumentId, count: LaneCount): (number | null)[] {
  if (count === 1) return events.map((e) => (e.kind === 'note' ? 0 : null));
  if (instrument === 'drums') {
    return events.map((e) => (e.kind !== 'note' ? null : count === 2 ? (LEFT_DRUMS.has(e.midi) ? 0 : 1) : drumLane(e.midi)));
  }
  return count === 2 ? twoLanes(events) : fourLanes(events);
}

// ---------- note types (Expert) ----------

/** A note this many beats or longer is a hold: keep the finger down until its tail ends */
export const HOLD_BEATS = 1.5;

/** Velocity above the part's average that makes a bar's first note an accent */
export const ACCENT_MARGIN = 10;

/** Default velocity of a note that does not set one (matches playback) */
const DEFAULT_VELOCITY = 96;

export const holdNotes = (events: readonly ScoreEvent[]): boolean[] => events.map((e) => e.kind === 'note' && e.beats >= HOLD_BEATS);

/**
 * Flick notes: the first note of a bar when it is a strong accent (velocity at
 * least the part's average plus ACCENT_MARGIN). At most one per bar, and never
 * a hold, which already asks the finger to stay down.
 */
export function flickNotes(events: readonly ScoreEvent[], beatsPerBar: number): boolean[] {
  const vel = (e: ScoreEvent) => (e.kind === 'note' ? (e.velocity ?? DEFAULT_VELOCITY) : 0);
  const notes = events.filter((e) => e.kind === 'note');
  const average = notes.length ? notes.reduce((sum, e) => sum + vel(e), 0) / notes.length : 0;
  const starts = onsets(events);
  const perBar = Math.max(1, beatsPerBar);
  let bar = -1;
  return events.map((e, i) => {
    if (e.kind !== 'note') return false;
    const at = Math.floor((starts[i] ?? 0) / perBar + 1e-9);
    if (at === bar) return false;
    bar = at;
    return e.beats < HOLD_BEATS && vel(e) >= average + ACCENT_MARGIN;
  });
}
