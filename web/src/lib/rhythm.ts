import type { ScoreEvent } from '@kilukkam/shared';

// The beat grid every phone shares. Server-clock ms in, beats out, with live
// tempo changes that never make the grid jump. Plus the judge: how close a
// tap landed to its note, and the running combo and accuracy.

/** A stretch of constant tempo starting at server time `at`, where beat `beat` falls. */
export interface TempoSegment {
  at: number;
  beat: number;
  bpm: number;
}

export class BeatGrid {
  private readonly segments: TempoSegment[];

  /** Beat 0 lands at `startedAt` (server ms). */
  constructor(startedAt: number, bpm: number) {
    this.segments = [{ at: startedAt, beat: 0, bpm }];
  }

  private segmentAtTime(t: number): TempoSegment {
    let seg = this.segments[0] as TempoSegment;
    for (const s of this.segments) if (s.at <= t) seg = s;
    return seg;
  }

  private segmentAtBeat(beat: number): TempoSegment {
    let seg = this.segments[0] as TempoSegment;
    for (const s of this.segments) if (s.beat <= beat) seg = s;
    return seg;
  }

  /** Beat position (fractional) at server time `t`; negative during the count-in. */
  beatAt(t: number): number {
    const s = this.segmentAtTime(t);
    return s.beat + ((t - s.at) * s.bpm) / 60_000;
  }

  /** Server time at which `beat` falls. */
  timeOf(beat: number): number {
    const s = this.segmentAtBeat(beat);
    return s.at + ((beat - s.beat) * 60_000) / s.bpm;
  }

  /** Change tempo from server time `at` onward, continuing from the beat already reached there. */
  setTempo(bpm: number, at: number): void {
    const beat = this.beatAt(at);
    const keep = this.segments.filter((s) => s.at < at);
    this.segments.splice(0, this.segments.length, ...(keep.length ? keep : [this.segments[0] as TempoSegment]), { at, beat, bpm });
  }

  /** Adopt the server's tempo anchor (beat `beat` at server time `at`), replacing anything after it. */
  anchor(seg: TempoSegment): void {
    const keep = this.segments.filter((s) => s.at < seg.at);
    this.segments.splice(0, this.segments.length, ...keep, { ...seg });
  }

  get bpm(): number {
    return (this.segments[this.segments.length - 1] as TempoSegment).bpm;
  }
}

/** Beat onset of every event in a part (rests included, so canon entries stay offset). */
export const onsets = (events: readonly ScoreEvent[]): number[] => {
  let beat = 0;
  return events.map((e) => {
    const at = beat;
    beat += e.beats;
    return at;
  });
};

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** Timing windows in ms either side of the note */
export const WINDOWS = { perfect: 50, great: 100, good: 170 } as const;

export const judge = (offsetMs: number): Judgement => {
  const d = Math.abs(offsetMs);
  if (d <= WINDOWS.perfect) return 'perfect';
  if (d <= WINDOWS.great) return 'great';
  if (d <= WINDOWS.good) return 'good';
  return 'miss';
};

const POINTS: Record<Judgement, number> = { perfect: 100, great: 75, good: 40, miss: 0 };

export interface Tally {
  notes: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  combo: number;
  bestCombo: number;
  /** 0 to 100: points earned over points possible */
  accuracy: number;
}

export const emptyTally = (): Tally => ({ notes: 0, perfect: 0, great: 0, good: 0, miss: 0, combo: 0, bestCombo: 0, accuracy: 0 });

export const record = (t: Tally, j: Judgement): Tally => {
  const notes = t.notes + 1;
  const combo = j === 'miss' ? 0 : t.combo + 1;
  const earned = (t.accuracy / 100) * t.notes * 100 + POINTS[j];
  return { ...t, notes, [j]: t[j] + 1, combo, bestCombo: Math.max(t.bestCombo, combo), accuracy: notes ? earned / notes : 0 };
};

export const grade = (accuracy: number, completion: number): 'S' | 'A' | 'B' | 'C' => {
  const score = accuracy * Math.min(1, completion);
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  return 'C';
};
