import { note, rest } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { beatPulse, restCountdown, spring, withAlpha } from '../src/lib/lane.js';
import { onsets } from '../src/lib/rhythm.js';

describe('beat pulse', () => {
  it('peaks on the beat and decays through it', () => {
    expect(beatPulse(3).strength).toBeCloseTo(1);
    expect(beatPulse(3.5).strength).toBeLessThan(0.1);
    expect(beatPulse(3.25).phase).toBeCloseTo(0.25);
  });
  it('marks beat 1 of each bar, count-in included', () => {
    expect(beatPulse(0).downbeat).toBe(true);
    expect(beatPulse(4.2).downbeat).toBe(true);
    expect(beatPulse(5).downbeat).toBe(false);
    expect(beatPulse(-4).downbeat).toBe(true);
    expect(beatPulse(-3).downbeat).toBe(false);
    expect(beatPulse(3, 3).downbeat).toBe(true);
  });
});

describe('rest countdown', () => {
  const events = [note(60, 1), rest(8), note(62, 1), rest(1), note(64, 1)];
  const starts = onsets(events);

  it('counts the beats until your part comes back in', () => {
    // C4 ends at beat 1; D4 enters at beat 9.
    expect(restCountdown(events, starts, 1, 2)).toBe(7);
    expect(restCountdown(events, starts, 1, 5)).toBe(4);
    expect(restCountdown(events, starts, 1, 7.5)).toBe(2);
    expect(restCountdown(events, starts, 1, 8)).toBe(1);
  });
  it('stays quiet for short gaps, past the end, and during the count-in', () => {
    expect(restCountdown(events, starts, 3, 10.2)).toBeNull();
    expect(restCountdown(events, starts, events.length, 20)).toBeNull();
    expect(restCountdown(events, starts, 1, -2)).toBeNull();
    expect(restCountdown(events, starts, 1, 8.9)).toBeNull();
  });
  it('counts a late entry from the downbeat', () => {
    const canon = [rest(8), note(67, 1)];
    expect(restCountdown(canon, onsets(canon), 0, 4)).toBe(4);
  });
});

describe('motion helpers', () => {
  it('springs from nothing past full size and settles', () => {
    expect(spring(0)).toBe(0);
    expect(Math.max(...[0.05, 0.1, 0.15, 0.2].map(spring))).toBeGreaterThan(1);
    expect(spring(1)).toBeCloseTo(1, 2);
  });
  it('adds alpha to hex colours', () => {
    expect(withAlpha('#b6f400', 0.5)).toBe('rgba(182, 244, 0, 0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('red', 0.3)).toBe('red');
  });
});
