import { describe, it, expect } from 'vitest';
import { start, extend, judgeEcho } from '../../src/games/echo.js';

const C_MAJOR = [60, 62, 64, 65, 67, 69, 71];

describe('echo start', () => {
  it('opens round 1 with one note from the scale', () => {
    const s = start(1, C_MAJOR);
    expect(s.round).toBe(1);
    expect(s.sequence).toHaveLength(1);
    expect(C_MAJOR).toContain(s.sequence[0]);
  });

  it('is deterministic for a seed', () => {
    expect(start(123, C_MAJOR)).toEqual(start(123, C_MAJOR));
  });

  it('rejects an empty scale', () => {
    expect(() => start(1, [])).toThrow(RangeError);
  });
});

describe('echo extend', () => {
  it('appends one scale note and bumps the round', () => {
    const s1 = start(5, C_MAJOR);
    const s2 = extend(s1);
    expect(s2.round).toBe(2);
    expect(s2.sequence).toHaveLength(2);
    expect(s2.sequence[0]).toBe(s1.sequence[0]);
    expect(C_MAJOR).toContain(s2.sequence[1]);
  });

  it('does not mutate the previous state', () => {
    const s1 = start(5, C_MAJOR);
    const snapshot = structuredClone(s1);
    extend(s1);
    expect(s1).toEqual(snapshot);
  });

  it('same seed, same sequence across a long chain', () => {
    let a = start(77, C_MAJOR);
    let b = start(77, C_MAJOR);
    for (let i = 0; i < 20; i++) { a = extend(a); b = extend(b); }
    expect(a.sequence).toEqual(b.sequence);
    expect(a.sequence).toHaveLength(21);
  });

  it('uses more than one note of the scale over time', () => {
    let s = start(3, C_MAJOR);
    for (let i = 0; i < 30; i++) s = extend(s);
    expect(new Set(s.sequence).size).toBeGreaterThan(3);
  });
});

describe('judgeEcho', () => {
  const state = { ...start(1, C_MAJOR), sequence: [60, 64, 67], round: 3 };

  it('ok for an exact repeat', () => {
    expect(judgeEcho(state, [60, 64, 67])).toEqual({ ok: true, failedAt: null });
  });

  it('fails at the first wrong tap', () => {
    expect(judgeEcho(state, [60, 65, 67])).toEqual({ ok: false, failedAt: 1 });
  });

  it('fails at the first missing tap when too short', () => {
    expect(judgeEcho(state, [60, 64])).toEqual({ ok: false, failedAt: 2 });
  });

  it('fails at the first extra tap when too long', () => {
    expect(judgeEcho(state, [60, 64, 67, 60])).toEqual({ ok: false, failedAt: 3 });
  });

  it('no taps fails at 0', () => {
    expect(judgeEcho(state, [])).toEqual({ ok: false, failedAt: 0 });
  });
});
