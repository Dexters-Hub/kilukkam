import type { InstrumentId, ScoreEvent } from '@kilukkam/shared';
import type { LaneSide } from '../../lib/lane.js';
import { onsets } from '../../lib/rhythm.js';

// Two hands: every note of a part goes to the left or the right lane, or to
// both when it is a chord. Pure, so the lane a note falls in is the same on
// every phone and in every test.

/** Semitones either side of the median where the melody's motion, not its pitch, picks the lane */
export const BAND = 2;

/** General MIDI drum keys played with the left hand: kicks and toms. Snare, clap, hats and cymbals go right. */
export const LEFT_DRUMS: ReadonlySet<number> = new Set([35, 36, 41, 43, 45, 47, 48, 50]);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * The lane of every event in `events` (null for rests).
 *
 * Melodic parts split around the part's median pitch: clearly low notes go
 * left, clearly high ones right. Near the median, a repeated note keeps its
 * lane and a moving note swaps hands, so a run alternates left and right.
 * Drums split by kit piece. Notes that start together with another note are
 * a chord and need both lanes.
 */
export function assignLanes(events: readonly ScoreEvent[], instrument: InstrumentId): (LaneSide | null)[] {
  const starts = onsets(events);
  const together = new Map<number, number>();
  events.forEach((e, i) => {
    if (e.kind === 'note') together.set(starts[i] ?? 0, (together.get(starts[i] ?? 0) ?? 0) + 1);
  });
  const pitches = events.flatMap((e) => (e.kind === 'note' ? [e.midi] : []));
  const mid = pitches.length ? median(pitches) : 0;
  let prev: { midi: number; side: 'left' | 'right' } | null = null;
  return events.map((e, i) => {
    if (e.kind !== 'note') return null;
    if ((together.get(starts[i] ?? 0) ?? 0) > 1) return 'both';
    if (instrument === 'drums') return LEFT_DRUMS.has(e.midi) ? 'left' : 'right';
    let side: 'left' | 'right';
    if (e.midi > mid + BAND) side = 'right';
    else if (e.midi < mid - BAND) side = 'left';
    else if (prev) side = e.midi === prev.midi ? prev.side : prev.side === 'left' ? 'right' : 'left';
    else side = e.midi >= mid ? 'right' : 'left';
    prev = { midi: e.midi, side };
    return side;
  });
}
