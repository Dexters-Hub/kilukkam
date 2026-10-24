import { describe, expect, it } from 'vitest';
import { BatonTracker, dynamicsFor, steadyTempo } from '../src/lib/baton.js';
import { BowDetector, ShakeDetector, tiltLevel, type MotionSample } from '../src/lib/motion.js';

const s = (t: number, x = 0, y = 0, z = 0): MotionSample => ({ t, x, y, z });

describe('BowDetector', () => {
  it('starts a stroke on a firm push and the next on reversing direction', () => {
    const bow = new BowDetector();
    expect(bow.push(s(0, 0.5))).toBeNull();
    expect(bow.push(s(20, 5))).toMatchObject({ kind: 'stroke', direction: 1 });
    expect(bow.push(s(60, 6))).toBeNull(); // same direction: still the same stroke
    expect(bow.push(s(300, -5))).toMatchObject({ kind: 'stroke', direction: -1 });
  });
  it('ignores reversals faster than a human bow change', () => {
    const bow = new BowDetector();
    bow.push(s(0, 5));
    expect(bow.push(s(50, -5))).toBeNull();
  });
  it('releases after the phone has been still for a moment', () => {
    const bow = new BowDetector();
    bow.push(s(0, 5));
    expect(bow.push(s(100, 0.2))).toBeNull();
    expect(bow.push(s(280, 0.1))).toEqual({ kind: 'release' });
    expect(bow.push(s(400, 0.1))).toBeNull(); // only once
  });
});

describe('ShakeDetector', () => {
  it('hits on a spike, with a refractory period', () => {
    const shake = new ShakeDetector();
    expect(shake.push(s(0, 3))).toBeNull();
    expect(shake.push(s(10, 15, 4))).toMatchObject({ kind: 'shake' });
    expect(shake.push(s(60, 16))).toBeNull();
    expect(shake.push(s(200, 16))).toMatchObject({ kind: 'shake' });
  });
});

describe('tiltLevel', () => {
  it('maps flat to soft and raised to full, clamped', () => {
    expect(tiltLevel(0)).toBeCloseTo(0.4);
    expect(tiltLevel(75)).toBeCloseTo(1.4);
    expect(tiltLevel(180)).toBeLessThanOrEqual(1.6);
    expect(tiltLevel(-30)).toBeCloseTo(tiltLevel(30));
  });
});

/** A hand beating time: down for half a beat, up for half, `amp` of the frame tall. */
const beating = (bpm: number, beats: number, amp = 0.3, fps = 60) => {
  const period = 60_000 / bpm;
  const out: { t: number; y: number }[] = [];
  for (let t = 0; t <= beats * period; t += 1000 / fps) {
    const phase = (t % period) / period;
    out.push({ t, y: 0.3 + amp * (phase < 0.5 ? phase * 2 : 2 - phase * 2) });
  }
  return out;
};

describe('BatonTracker', () => {
  it("finds one beat per downstroke and the conductor's tempo", () => {
    const baton = new BatonTracker();
    const beats = beating(90, 8).map((p) => baton.push(p)).filter((b) => b !== null);
    expect(beats.length).toBeGreaterThanOrEqual(7);
    const last = beats[beats.length - 1];
    expect(last?.bpm).toBeGreaterThanOrEqual(87);
    expect(last?.bpm).toBeLessThanOrEqual(93);
  });
  it('ignores small twitches', () => {
    const baton = new BatonTracker();
    expect(beating(120, 6, 0.02).map((p) => baton.push(p)).filter(Boolean)).toHaveLength(0);
  });
  it('big gestures read as loud, small as soft', () => {
    const big = new BatonTracker();
    const b = beating(80, 4, 0.5).map((p) => big.push(p)).filter((x) => x !== null).pop();
    expect(dynamicsFor(b?.size ?? 0)).toMatch(/^(f|ff)$/);
    const small = new BatonTracker();
    const q = beating(80, 4, 0.1).map((p) => small.push(p)).filter((x) => x !== null).pop();
    expect(dynamicsFor(q?.size ?? 0)).toMatch(/^(pp|p)$/);
  });
});

describe('steadyTempo', () => {
  it('clamps and ignores jitter', () => {
    expect(steadyTempo(100, 101)).toBe(100);
    expect(steadyTempo(100, 110)).toBe(110);
    expect(steadyTempo(100, 400)).toBe(200);
  });
});
