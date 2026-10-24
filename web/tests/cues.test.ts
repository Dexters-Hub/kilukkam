import type { ScoreEvent } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { DYNAMICS, DYNAMICS_GAIN, barNotes, buildEntry, clampBpm, countdownLabel, nextBar } from '../src/app/cues.js';
import { onsets } from '../src/lib/rhythm.js';

const note = (beats: number): ScoreEvent => ({ kind: 'note', midi: 60, beats });
const rest = (beats: number): ScoreEvent => ({ kind: 'rest', beats });

describe('dynamics', () => {
  it('runs pp to ff and gets louder', () => {
    expect(DYNAMICS).toEqual(['pp', 'p', 'mf', 'f', 'ff']);
    const gains = DYNAMICS.map((l) => DYNAMICS_GAIN[l]);
    expect([...gains].sort((a, b) => a - b)).toEqual(gains);
    expect(DYNAMICS_GAIN.mf).toBe(1);
  });
});

describe('nextBar', () => {
  it('rounds up to the next downbeat', () => {
    expect(nextBar(0)).toBe(4);
    expect(nextBar(5.5)).toBe(8);
    expect(nextBar(7.99)).toBe(8);
    expect(nextBar(8)).toBe(12);
    expect(nextBar(5, 2)).toBe(12);
  });
});

describe('barNotes', () => {
  const events = [note(1), note(1), rest(2), note(2), note(2), note(4)];
  const o = onsets(events); // 0 1 2 4 6 8
  it('finds the notes inside the bar that holds the beat, skipping rests', () => {
    expect(barNotes(events, o, 1.5)).toEqual([0, 1]);
    expect(barNotes(events, o, 4)).toEqual([3, 4]);
    expect(barNotes(events, o, 4, 2)).toEqual([3, 4, 5]);
  });
  it('is empty past the end', () => {
    expect(barNotes(events, o, 40)).toEqual([]);
  });
});

describe('buildEntry', () => {
  it('brings sections in by score order across the build', () => {
    expect(buildEntry(0, 4, 8000)).toBe(0);
    expect(buildEntry(1, 4, 8000)).toBe(2000);
    expect(buildEntry(3, 4, 8000)).toBe(6000);
    expect(buildEntry(9, 4, 8000)).toBe(6000);
    expect(buildEntry(0, 1, 8000)).toBe(0);
  });
});

describe('countdownLabel', () => {
  it('says get ready before the count-in, then counts beats down', () => {
    expect(countdownLabel(5000, 500, 4)).toBe('Get ready');
    expect(countdownLabel(2000, 500, 4)).toBe('4');
    expect(countdownLabel(1600, 500, 4)).toBe('4');
    expect(countdownLabel(400, 500, 4)).toBe('1');
    expect(countdownLabel(0, 500, 4)).toBeNull();
    expect(countdownLabel(-20, 500, 4)).toBeNull();
  });
});

describe('clampBpm', () => {
  it('rounds and keeps the tempo in range', () => {
    expect(clampBpm(132.6, 40, 200)).toBe(133);
    expect(clampBpm(10, 40, 200)).toBe(40);
    expect(clampBpm(999, 40, 200)).toBe(200);
  });
});
