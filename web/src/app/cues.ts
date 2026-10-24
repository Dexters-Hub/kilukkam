import type { DynamicsLevel, ScoreEvent } from '@kilukkam/shared';

// Pure helpers for the conductor's live cues, kept free of DOM so tests run in node.

export const DYNAMICS: readonly DynamicsLevel[] = ['pp', 'p', 'mf', 'f', 'ff'];

export const DYNAMICS_LABEL: Record<DynamicsLevel, string> = {
  pp: 'Very soft',
  p: 'Soft',
  mf: 'Medium',
  f: 'Loud',
  ff: 'Very loud',
};

/** Loudness multiplier a phone applies to every note at this level */
export const DYNAMICS_GAIN: Record<DynamicsLevel, number> = { pp: 0.4, p: 0.65, mf: 1, f: 1.25, ff: 1.5 };

export const BEATS_PER_BAR = 4;

/** First beat of the bar after `beat` (a downbeat exactly on `beat` counts as the next one) */
export const nextBar = (beat: number, bars = 1): number => (Math.floor(beat / BEATS_PER_BAR) + Math.max(1, bars)) * BEATS_PER_BAR;

/** Note indices whose onset falls in the bar that holds `beat`, `bars` bars long */
export const barNotes = (events: readonly ScoreEvent[], onsetBeats: readonly number[], beat: number, bars = 1): number[] => {
  const start = Math.floor(beat / BEATS_PER_BAR) * BEATS_PER_BAR;
  const end = start + Math.max(1, bars) * BEATS_PER_BAR;
  const out: number[] = [];
  events.forEach((e, i) => {
    const at = onsetBeats[i] ?? -1;
    if (e.kind === 'note' && at >= start && at < end) out.push(i);
  });
  return out;
};

/**
 * When a section joins during a build: sections enter in score order, the
 * first at once and the last one bar before the build ends.
 */
export const buildEntry = (order: number, sections: number, buildMs: number): number => {
  if (sections <= 1) return 0;
  const step = buildMs / sections;
  return Math.max(0, Math.min(order, sections - 1)) * step;
};

/** What the count-in shows `ms` before the first downbeat, given the beat length. */
export const countdownLabel = (msToDownbeat: number, beatMs: number, countInBeats: number): string | null => {
  if (msToDownbeat <= 0) return null;
  const beats = Math.ceil(msToDownbeat / beatMs);
  return beats > countInBeats ? 'Get ready' : String(beats);
};

/** Clamp and round a slider value to a tempo the server accepts. */
export const clampBpm = (bpm: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(bpm)));
