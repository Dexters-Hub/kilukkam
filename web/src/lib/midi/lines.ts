import { note, rest, type ScoreEvent } from '@kilukkam/shared';

// Monophonic lines on an integer step grid. Integers keep every part's
// total exact (a triplet grid would drift in floating-point beats), and
// conversion to beats happens once, in toEvents.

export interface StepNote {
  midi: number;
  /** Inclusive start step */
  start: number;
  /** Exclusive end step; always greater than start */
  end: number;
  velocity: number;
}

/** Sorted by start, never overlapping: one note at a time, like one tap at a time. */
export type Line = readonly StepNote[];

export interface Range {
  low: number;
  high: number;
}

const byStart = (a: StepNote, b: StepNote): number => a.start - b.start || a.midi - b.midi;

/**
 * Reduce polyphony to the outermost voice. At each onset the most extreme
 * new note wins; a less extreme note that starts while a more extreme one
 * still sounds is ignored, otherwise the held note is cut where the new one
 * starts. Trade-off: when an outer note ends, the line does not resume an
 * inner note already sounding; it waits for the next onset.
 */
function outerLine(notes: readonly StepNote[], beats: (a: StepNote, b: StepNote) => boolean): StepNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || (beats(a, b) ? -1 : beats(b, a) ? 1 : b.end - a.end));
  const out: StepNote[] = [];
  for (const n of sorted) {
    const prev = out.at(-1);
    if (prev && n.start === prev.start) continue;
    if (prev && prev.end > n.start) {
      if (beats(prev, n)) continue;
      out[out.length - 1] = { ...prev, end: n.start };
    }
    out.push(n);
  }
  return out;
}

export const skyline = (notes: readonly StepNote[]): StepNote[] => outerLine(notes, (a, b) => a.midi > b.midi);
export const bottomline = (notes: readonly StepNote[]): StepNote[] => outerLine(notes, (a, b) => a.midi < b.midi);

/** The note sounding at `step`, by binary search. */
export function noteAt(line: Line, step: number): StepNote | undefined {
  let lo = 0;
  let hi = line.length - 1;
  let found: StepNote | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = line[mid];
    if (n === undefined) break;
    if (n.start <= step) {
      found = n;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found && step < found.end ? found : undefined;
}

/**
 * At most one onset per cell of `cellSteps`. The kept note (the first, or the
 * lowest for a bass) takes the cell's span so the line does not go silent.
 */
export function thinToCells(line: Line, cellSteps: number, pick: 'first' | 'lowest'): StepNote[] {
  if (cellSteps <= 1) return [...line];
  const groups: StepNote[][] = [];
  for (const n of line) {
    const last = groups.at(-1);
    const head = last?.[0];
    if (last && head && Math.floor(head.start / cellSteps) === Math.floor(n.start / cellSteps)) last.push(n);
    else groups.push([n]);
  }
  // A line never overlaps, so the group's last end is still before the next group starts.
  return groups.flatMap((g) => {
    const first = g[0];
    const last = g.at(-1);
    if (!first || !last) return [];
    const chosen = pick === 'first' ? first : g.reduce((lo, n) => (n.midi < lo.midi ? n : lo), first);
    return [{ ...chosen, start: first.start, end: last.end }];
  });
}

/** Tie same-pitch notes that touch, up to `maxSteps` long, so a held chord tone is one tap. */
export function mergeRepeats(line: Line, maxSteps: number): StepNote[] {
  const out: StepNote[] = [];
  for (const n of line) {
    const prev = out.at(-1);
    if (prev && prev.midi === n.midi && prev.end === n.start && n.end - prev.start <= maxSteps) {
      out[out.length - 1] = { ...prev, end: n.end };
    } else {
      out.push(n);
    }
  }
  return out;
}

/** Fold gaps shorter than `minGap` steps into the note before them: a tap game has no use for tiny rests. */
export function absorbShortRests(line: Line, minGap: number): StepNote[] {
  return line.map((n, i) => {
    const next = line[i + 1];
    return next && next.start > n.end && next.start - n.end < minGap ? { ...n, end: next.start } : n;
  });
}

/** Cut a line at `endStep`: later notes go, a note across the cut is shortened. */
export const truncate = (line: Line, endStep: number): StepNote[] =>
  line.filter((n) => n.start < endStep).map((n) => (n.end > endStep ? { ...n, end: endStep } : n));

export const transpose = (line: Line, semitones: number): StepNote[] => line.map((n) => ({ ...n, midi: n.midi + semitones }));

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const at = (i: number) => sorted[i] ?? 0;
  return sorted.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}

export const lineRange = (line: Line): Range => ({
  low: Math.min(...line.map((n) => n.midi)),
  high: Math.max(...line.map((n) => n.midi)),
});

export interface Fit {
  line: StepNote[];
  /** Whole-line octave shift in semitones */
  shift: number;
  /** Notes that needed their own octave fold after the shift */
  folded: number;
  /** The fitted line's median ended above the requested ceiling */
  above: boolean;
}

/**
 * Fit a line into an instrument's recorded range. First one octave shift
 * for the whole line (keeps the contour), chosen to leave the fewest notes
 * outside, then optionally to stay under `ceiling` (a harmony under its
 * melody), then the smallest move. Notes still outside fold by octaves.
 */
export function fitRange(line: Line, range: Range, ceiling?: number): Fit {
  const mid = median(line.map((n) => n.midi));
  let best = { shift: 0, cost: Infinity, above: false };
  for (let shift = -48; shift <= 48; shift += 12) {
    const outside = line.filter((n) => n.midi + shift < range.low || n.midi + shift > range.high).length;
    const above = ceiling !== undefined && mid + shift > ceiling;
    const cost = outside * 1000 + (above ? 100 : 0) + Math.abs(shift) / 12;
    if (cost < best.cost) best = { shift, cost, above };
  }
  let folded = 0;
  const fitted = line.map((n) => {
    let m = n.midi + best.shift;
    while (m < range.low) m += 12;
    while (m > range.high) m -= 12;
    if (m !== n.midi + best.shift) folded += 1;
    return m === n.midi ? n : { ...n, midi: m };
  });
  return { line: fitted, shift: best.shift, folded, above: best.above };
}

/** Events a line renders to: its notes plus the rests between them and to the end. */
export function eventCount(line: Line, totalSteps: number): number {
  let count = 0;
  let at = 0;
  for (const n of line) {
    if (n.start > at) count += 1;
    count += 1;
    at = n.end;
  }
  return at < totalSteps ? count + 1 : count;
}

export function toEvents(line: Line, totalSteps: number, stepsPerBeat: number): ScoreEvent[] {
  const beats = (steps: number) => steps / stepsPerBeat;
  const events: ScoreEvent[] = [];
  let at = 0;
  for (const n of line) {
    if (n.start > at) events.push(rest(beats(n.start - at)));
    events.push(note(n.midi, beats(n.end - n.start), n.velocity));
    at = n.end;
  }
  if (at < totalSteps) events.push(rest(beats(totalSteps - at)));
  return events;
}

export const sortLine = (notes: readonly StepNote[]): StepNote[] => [...notes].sort(byStart);
