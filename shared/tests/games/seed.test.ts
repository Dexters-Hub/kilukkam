import { describe, it, expect } from 'vitest';
import { fnv1a, dailySeed, pickDaily, mulberry32, nextRandom } from '../../src/games/seed.js';

function isoDays(start: string, n: number): string[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
}

describe('fnv1a', () => {
  it('matches the reference 32-bit vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('dailySeed', () => {
  it('is stable for a fixed date', () => {
    expect(dailySeed('2026-10-24')).toBe(fnv1a('2026-10-24'));
    expect(dailySeed('2026-10-24')).toBe(dailySeed('2026-10-24'));
  });

  it('ignores the time part of a full ISO timestamp', () => {
    expect(dailySeed('2026-10-24T23:59:59.000Z')).toBe(dailySeed('2026-10-24'));
  });

  it('is an unsigned 32-bit int', () => {
    for (const d of isoDays('2026-01-01', 30)) {
      const s = dailySeed(d);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it('differs between consecutive days', () => {
    expect(dailySeed('2026-10-24')).not.toBe(dailySeed('2026-10-25'));
  });

  it('rejects malformed dates', () => {
    expect(() => dailySeed('24/10/2026')).toThrow(RangeError);
    expect(() => dailySeed('')).toThrow(RangeError);
  });
});

describe('pickDaily', () => {
  const pool = Array.from({ length: 40 }, (_, i) => i);

  it('is stable per day', () => {
    expect(pickDaily('2026-10-24', pool)).toBe(pickDaily('2026-10-24', pool));
  });

  it('is roughly uniform over 365 days', () => {
    const counts = new Array<number>(pool.length).fill(0);
    for (const d of isoDays('2027-01-01', 365)) counts[pickDaily(d, pool)]! += 1;
    const expected = 365 / pool.length;
    // Most of the pool is seen and nothing dominates
    expect(counts.filter((c) => c > 0).length).toBeGreaterThanOrEqual(36);
    expect(Math.max(...counts)).toBeLessThanOrEqual(expected * 2.5);
    // Chi-square, 39 degrees of freedom: 99.9th percentile is about 72.1
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(72.1);
  });

  it('spreads a small pool evenly', () => {
    const small = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const counts = new Map<string, number>();
    for (const d of isoDays('2027-01-01', 365)) {
      const p = pickDaily(d, small);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const expected = 365 / small.length;
    for (const s of small) {
      expect(counts.get(s) ?? 0).toBeGreaterThan(expected * 0.6);
      expect(counts.get(s) ?? 0).toBeLessThan(expected * 1.4);
    }
  });

  it('rejects an empty pool', () => {
    expect(() => pickDaily('2026-10-24', [])).toThrow(RangeError);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('yields floats in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds give different streams', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('nextRandom is the pure step behind mulberry32', () => {
    const r = mulberry32(99);
    const first = nextRandom(99);
    const second = nextRandom(first.state);
    expect(r()).toBe(first.value);
    expect(r()).toBe(second.value);
  });
});
