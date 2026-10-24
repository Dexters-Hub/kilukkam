import { CUSTOM_PIECE_LIMITS, validateScore } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { buildPlayAlong } from '../src/lib/spotify/playalong.js';
import {
  barsFromDuration,
  beatAtOrAfter,
  expectedPosition,
  foldBpm,
  maxBarsFor,
  planStart,
  playAlongTitle,
  seekCorrection,
  songBeatFromTaps,
} from '../src/lib/spotify/sync.js';

/** Is `t` on the grid songBeatMs + k * period (within a hair)? */
const onGrid = (t: number, songBeatMs: number, periodMs: number): boolean => {
  const k = (t - songBeatMs) / periodMs;
  return Math.abs(k - Math.round(k)) < 1e-6;
};

describe('tap to song phase', () => {
  it('finds the period and the first beat in the song from song-time taps', () => {
    // 120 bpm, beats at 250 + 500k ms of song time; taps from 10.25 s in.
    const taps = [10_250, 10_750, 11_250, 11_750, 12_250];
    const b = songBeatFromTaps(taps);
    expect(b).not.toBeNull();
    expect(b?.bpm).toBeCloseTo(120, 6);
    expect(b?.periodMs).toBeCloseTo(500, 6);
    expect(b?.songBeatMs).toBeCloseTo(250, 6);
    expect(b?.confidence).toBeGreaterThan(0.99);
  });

  it('averages out human jitter', () => {
    const taps = [3_010, 3_590, 4_215, 4_790, 5_405, 6_000];
    const b = songBeatFromTaps(taps);
    expect(b?.bpm).toBeGreaterThan(98);
    expect(b?.bpm).toBeLessThan(102);
    expect(b?.songBeatMs).toBeGreaterThanOrEqual(0);
    expect(b?.songBeatMs).toBeLessThan(b?.periodMs ?? 0);
    expect(b?.confidence).toBeLessThan(1);
  });

  it('needs four taps', () => {
    expect(songBeatFromTaps([1000, 1500, 2000])).toBeNull();
  });

  it('folds a tempo into the room range without moving the beats', () => {
    expect(foldBpm(240)).toBe(120);
    expect(foldBpm(35)).toBe(70);
    expect(foldBpm(90)).toBe(90);
    expect(foldBpm(0)).toBeNull();
    // 240 bpm taps: half time keeps every other tap on the grid.
    const b = songBeatFromTaps([1000, 1250, 1500, 1750, 2000]);
    expect(b?.bpm).toBeCloseTo(120, 6);
    expect(onGrid(2000, b?.songBeatMs ?? NaN, b?.periodMs ?? NaN)).toBe(true);
  });

  it('beatAtOrAfter picks the smallest grid beat at or after the bound', () => {
    expect(beatAtOrAfter(250, 500, 0)).toBe(250);
    expect(beatAtOrAfter(250, 500, 250)).toBe(250);
    expect(beatAtOrAfter(250, 500, 251)).toBe(750);
    expect(beatAtOrAfter(10_250, 500, 0)).toBe(250);
    expect(beatAtOrAfter(250, 500, 3000)).toBe(3250);
  });
});

describe('bars from duration', () => {
  const beat = { songBeatMs: 250, periodMs: 500 };

  it('counts whole bars from the first beat after the count-in to the end', () => {
    // Start at 3250 ms; 4/4 bars of 2 s; (180000 - 3250) / 2000 = 88.4
    expect(barsFromDuration(180_000, beat, 4)).toBe(88);
    // 3/4 bars of 1.5 s: 117.8
    expect(barsFromDuration(180_000, beat, 3)).toBe(117);
  });

  it('clamps to at least one bar and to the score limits', () => {
    expect(barsFromDuration(1000, beat, 4)).toBe(1);
    expect(barsFromDuration(60 * 60_000, beat, 4)).toBe(maxBarsFor(4));
    expect(maxBarsFor(4)).toBeLessThanOrEqual(256);
    expect(maxBarsFor(7) * 7 * 2).toBeLessThanOrEqual(CUSTOM_PIECE_LIMITS.maxEventsPerTrack);
  });

  it('always yields a score the server accepts', () => {
    for (const beatsPerBar of [3, 4]) {
      const bars = barsFromDuration(60 * 60_000, beat, beatsPerBar);
      const score = buildPlayAlong({ bpm: 120, beatsPerBar, bars, key: { tonic: 9, mode: 'minor' } });
      expect(validateScore(score)).toEqual([]);
      for (const t of score.tracks) expect(t.events.length).toBeLessThanOrEqual(CUSTOM_PIECE_LIMITS.maxEventsPerTrack);
    }
  });
});

describe('play-along title', () => {
  it('names the song and artists', () => {
    expect(playAlongTitle('Song', ['A', 'B'])).toBe('Song by A, B');
    expect(playAlongTitle('Song', [])).toBe('Song');
  });

  it('respects the 80 character cap', () => {
    const t = playAlongTitle('A very long song name that keeps on going', ['An artist with a long name', 'Another one', 'And more']);
    expect(t.length).toBeLessThanOrEqual(CUSTOM_PIECE_LIMITS.maxTitleLen);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('start position', () => {
  const beat = { songBeatMs: 250, periodMs: 500 };

  it('puts a song beat exactly on the room start, playing through the count-in', () => {
    const now = 1_000_000;
    const startedAtLocal = now + 3000;
    const plan = planStart({ ...beat, startedAtLocal, nowLocal: now, leadMs: 0 });
    expect(onGrid(plan.targetSongMs, beat.songBeatMs, beat.periodMs)).toBe(true);
    expect(plan.targetSongMs).toBe(3250);
    expect(plan.playFromMs).toBe(250);
    // Played from now at playFromMs, the song is at the target when the room starts.
    expect(plan.playFromMs + (startedAtLocal - now)).toBe(plan.targetSongMs);
    expect(expectedPosition(plan, startedAtLocal, startedAtLocal)).toBe(plan.targetSongMs);
  });

  it('asks a little ahead to absorb the start delay', () => {
    const plan = planStart({ ...beat, startedAtLocal: 5000, nowLocal: 2000, leadMs: 150 });
    expect(plan.playFromMs).toBe(plan.targetSongMs - 3000 + 150);
  });

  it('handles a start that is already past', () => {
    const plan = planStart({ ...beat, startedAtLocal: 1000, nowLocal: 1400, leadMs: 0 });
    expect(onGrid(plan.targetSongMs, beat.songBeatMs, beat.periodMs)).toBe(true);
    expect(plan.playFromMs).toBe(plan.targetSongMs + 400);
    expect(expectedPosition(plan, 1000, 1400)).toBe(plan.playFromMs);
  });

  it('never asks for a negative position', () => {
    const plan = planStart({ songBeatMs: 0, periodMs: 500, startedAtLocal: 10_000, nowLocal: 9_900, leadMs: 0 });
    expect(plan.playFromMs).toBeGreaterThanOrEqual(0);
    expect(onGrid(plan.targetSongMs, 0, 500)).toBe(true);
  });
});

describe('seek correction', () => {
  it('leaves small errors alone', () => {
    expect(seekCorrection(10_030, 10_000)).toBeNull();
    expect(seekCorrection(9_960, 10_000)).toBeNull();
  });

  it('seeks to the expected position past 40 ms', () => {
    expect(seekCorrection(10_041, 10_000)).toBe(10_000);
    expect(seekCorrection(9_900, 10_000)).toBe(10_000);
    expect(seekCorrection(100, -50)).toBe(0);
  });
});
