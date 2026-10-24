import { describe, it, expect } from 'vitest';
import { judgeTempo, medianBpm } from '../../src/games/tempo.js';

describe('judgeTempo', () => {
  it('perfect within 3 percent', () => {
    expect(judgeTempo(100, 100)).toBe('perfect');
    expect(judgeTempo(103, 100)).toBe('perfect');
    expect(judgeTempo(97, 100)).toBe('perfect');
  });

  it('great within 8 percent', () => {
    expect(judgeTempo(104, 100)).toBe('great');
    expect(judgeTempo(92, 100)).toBe('great');
  });

  it('good within 15 percent', () => {
    expect(judgeTempo(115, 100)).toBe('good');
    expect(judgeTempo(91, 100)).toBe('good');
  });

  it('close within 25 percent', () => {
    expect(judgeTempo(125, 100)).toBe('close');
    expect(judgeTempo(80, 100)).toBe('close');
  });

  it('miss beyond 25 percent', () => {
    expect(judgeTempo(126, 100)).toBe('miss');
    expect(judgeTempo(60, 100)).toBe('miss');
  });

  it('miss for non-finite or non-positive input', () => {
    expect(judgeTempo(Number.NaN, 100)).toBe('miss');
    expect(judgeTempo(100, 0)).toBe('miss');
  });
});

describe('medianBpm', () => {
  it('null for no usable taps', () => {
    expect(medianBpm([])).toBeNull();
    expect(medianBpm([Number.NaN, -5, 0])).toBeNull();
  });

  it('median of an odd count', () => {
    expect(medianBpm([120, 100, 110])).toBe(110);
  });

  it('median of an even count averages the middle pair', () => {
    expect(medianBpm([100, 110, 120, 130])).toBe(115);
  });

  it('ignores non-finite and non-positive taps', () => {
    expect(medianBpm([100, Number.NaN, 0, 120, Infinity, 110])).toBe(110);
  });

  it('wild taps at either end do not move the answer', () => {
    const taps = [10, 100, 100, 100, 100, 120, 120, 120, 120, 500];
    expect(medianBpm(taps)).toBe(110);
    const twenty = [1, 2, ...Array.from({ length: 16 }, () => 90), 999, 999];
    expect(medianBpm(twenty)).toBe(90);
  });

  it('a few outliers in a small room are ignored too', () => {
    expect(medianBpm([1, 100, 100, 100, 1000])).toBe(100);
  });

  it('does not mutate its input', () => {
    const taps = [130, 100, 120];
    medianBpm(taps);
    expect(taps).toEqual([130, 100, 120]);
  });
});
