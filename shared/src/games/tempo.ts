// Thaala: the tempo round. pitchd BPM Guesser bands.

export type TempoGrade = 'perfect' | 'great' | 'good' | 'close' | 'miss';

const BANDS: readonly [TempoGrade, number][] = [
  ['perfect', 0.03],
  ['great', 0.08],
  ['good', 0.15],
  ['close', 0.25],
];

function usable(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm > 0;
}

export function judgeTempo(guessBpm: number, trueBpm: number): TempoGrade {
  if (!usable(guessBpm) || !usable(trueBpm)) return 'miss';
  const err = Math.abs(guessBpm - trueBpm) / trueBpm;
  return BANDS.find(([, max]) => err <= max)?.[0] ?? 'miss';
}

/**
 * The room's tempo from every phone's tapped bpm. A median already
 * shrugs off wild taps (trimming the same share from both ends never
 * moves it), so no separate trim step. Null when nothing usable came in.
 */
export function medianBpm(taps: readonly number[]): number | null {
  const sorted = taps.filter(usable).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
