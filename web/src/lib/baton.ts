// The conductor's baton, tracked by the laptop camera. Pure gesture maths:
// hand height over time in, beats, tempo and dynamics out. The camera binding
// (MediaPipe hand landmarks) only feeds `push` with the wrist position.

export interface BatonSample {
  /** ms */
  t: number;
  /** Hand height in the frame, 0 = top, 1 = bottom (camera image coordinates) */
  y: number;
}

export interface BatonBeat {
  t: number;
  /** Tempo from the last few beats, once there are enough to trust */
  bpm: number | null;
  /** How big the gesture was, 0 to 1: big beats mean loud */
  size: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/**
 * A beat is the bottom of a downstroke ("the ictus"): the hand was moving
 * down and turns back up, after travelling far enough to be deliberate.
 * Tempo is the median of the recent beat intervals, so one sloppy beat
 * doesn't jerk the room around.
 */
export class BatonTracker {
  private prev: BatonSample | null = null;
  private goingDown = false;
  private top = 1;
  private beats: number[] = [];

  constructor(
    private readonly minTravel = 0.06,
    private readonly minGapMs = 250,
    private readonly window = 5,
  ) {}

  push(s: BatonSample): BatonBeat | null {
    const prev = this.prev;
    this.prev = s;
    if (!prev) {
      this.top = s.y;
      return null;
    }
    const dy = s.y - prev.y;
    if (dy > 0.002) {
      if (!this.goingDown) this.top = prev.y;
      this.goingDown = true;
      return null;
    }
    if (dy < -0.002 && this.goingDown) {
      this.goingDown = false;
      const travel = prev.y - this.top;
      const last = this.beats[this.beats.length - 1];
      if (travel < this.minTravel || (last !== undefined && prev.t - last < this.minGapMs)) return null;
      this.beats.push(prev.t);
      if (this.beats.length > this.window) this.beats.shift();
      const gaps = this.beats.slice(1).map((b, i) => b - (this.beats[i] ?? b));
      const bpm = gaps.length >= 2 ? Math.round(60_000 / median(gaps)) : null;
      return { t: prev.t, bpm, size: Math.min(1, travel / 0.45) };
    }
    return null;
  }

  reset(): void {
    this.prev = null;
    this.goingDown = false;
    this.beats = [];
  }
}

export type Dynamics = 'pp' | 'p' | 'mf' | 'f' | 'ff';

/** Gesture size to dynamics: small, careful beats are soft; big sweeping ones are loud. */
export const dynamicsFor = (size: number): Dynamics => {
  if (size < 0.18) return 'pp';
  if (size < 0.34) return 'p';
  if (size < 0.55) return 'mf';
  if (size < 0.78) return 'f';
  return 'ff';
};

/** Keep tempo changes musical: clamp to a playable range and ignore jitter under 3 bpm. */
export const steadyTempo = (current: number, measured: number, min = 40, max = 200): number => {
  const next = Math.max(min, Math.min(max, measured));
  return Math.abs(next - current) < 3 ? current : next;
};
