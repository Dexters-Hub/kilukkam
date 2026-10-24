import { describe, expect, it } from 'vitest';
import type { Fingers, HandFrame, Handedness, TrackedHand } from '../src/lib/camera/features.js';
import { createFingerPlay, voicesFor, type FingerCue } from '../src/lib/camera/fingers.js';
import { PATTERNS, PatternCoach, TargetCoach, arrivalScore, reachScore, batonGrade, boxAround, guideAt, guidePath, meterFor, shapeScore, timingScore, toBox, toFrame } from '../src/lib/camera/pattern.js';

describe('conducting patterns', () => {
  it('passes through each ictus exactly on the beat', () => {
    for (const meter of [2, 3, 4] as const) {
      PATTERNS[meter].forEach((p, i) => {
        const g = guideAt(meter, i);
        expect(g.x).toBeCloseTo(p.x, 6);
        expect(g.y).toBeCloseTo(p.y, 6);
      });
    }
  });
  it('4/4 goes down, left, right, up', () => {
    const [one, two, three, four] = PATTERNS[4];
    expect(one && two && one.y > two.y && two.x < one.x).toBe(true);
    expect(three && two && three.x > two.x).toBe(true);
    expect(four && one && four.y < one.y).toBe(true);
  });
  it('loops: beat n equals beat 0, and the path is closed', () => {
    const a = guideAt(4, 0);
    const b = guideAt(4, 4);
    expect(b.x).toBeCloseTo(a.x, 6);
    const path = guidePath(3, 10);
    expect(path).toHaveLength(31);
  });
  it('stays roughly inside the box', () => {
    for (const p of guidePath(4)) {
      expect(p.x).toBeGreaterThan(-0.15);
      expect(p.x).toBeLessThan(1.15);
      expect(p.y).toBeGreaterThan(-0.15);
      expect(p.y).toBeLessThan(1.15);
    }
  });
  it('maps meters: 6/8 in two, odd meters in four', () => {
    expect(meterFor(6)).toBe(2);
    expect(meterFor(3)).toBe(3);
    expect(meterFor(5)).toBe(4);
  });
});

describe('box placement', () => {
  it('round-trips between box and frame coordinates', () => {
    const box = boxAround({ x: 0.5, y: 0.5 }, 4 / 3);
    const p = { x: 0.3, y: 0.7 };
    const back = toBox(toFrame(p, box, 4 / 3), box, 4 / 3);
    expect(back.x).toBeCloseTo(0.3, 9);
    expect(back.y).toBeCloseTo(0.7, 9);
  });
  it('keeps the box inside the frame near the edges', () => {
    const box = boxAround({ x: 0.98, y: 0.02 }, 16 / 9);
    expect(box.x + box.size / (16 / 9)).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

describe('baton scoring', () => {
  it('maps distance and timing to 0..100', () => {
    expect(shapeScore(0.02)).toBe(100);
    expect(shapeScore(0.4)).toBe(0);
    expect(timingScore(30)).toBe(100);
    expect(timingScore(-400)).toBe(0);
    expect(batonGrade(90)).toBe('perfect');
    expect(batonGrade(20)).toBe('miss');
  });
  it('a hand that follows the guide and lands on the beat scores perfect', () => {
    const coach = new PatternCoach(4);
    const results = [];
    for (let k = 0; k <= 8 * 30; k++) {
      const beat = k / 30;
      if (k % 30 === 0) coach.ictus(10);
      const r = coach.sample(guideAt(4, beat), beat);
      if (r) results.push(r);
    }
    expect(results.length).toBe(8);
    expect(results.every((r) => r.grade === 'perfect')).toBe(true);
    expect(coach.accuracy).toBeGreaterThanOrEqual(95);
  });
  it('a hand that wanders and is late scores low', () => {
    const coach = new PatternCoach(4);
    let last = null;
    for (let k = 0; k <= 4 * 30; k++) {
      const beat = k / 30;
      if (k % 30 === 0) coach.ictus(280);
      const r = coach.sample({ x: 0.5, y: 0.1 }, beat);
      if (r) last = r;
    }
    expect(last?.grade).toBe('miss');
    expect(coach.accuracy).toBeLessThan(40);
  });
});

const hand = (handedness: Handedness, fingersUp: Fingers): TrackedHand =>
  ({ handedness, fingersUp, score: 1, wrist: { x: 0.5, y: 0.8 }, indexTip: { x: 0.5, y: 0.4 }, palmCenter: { x: 0.5, y: 0.6 }, size: 0.12, pinch: false, pinchDistance: 1, openPalm: false, fist: false, landmarks: [] }) as TrackedHand;
const frame = (t: number, ...hands: TrackedHand[]): HandFrame => ({ t, aspect: 4 / 3, hands });
const DOWN: Fingers = [false, false, false, false, false];
const INDEX: Fingers = [false, true, false, false, false];

describe('finger play', () => {
  it('raising a finger starts its voice and lowering releases it, after debounce', () => {
    const cues: FingerCue[] = [];
    const play = createFingerPlay((c) => cues.push(c));
    play.push(frame(0, hand('right', DOWN)));
    for (let i = 1; i <= 3; i++) play.push(frame(i * 33, hand('right', INDEX)));
    expect(cues).toEqual([{ kind: 'down', t: 99, hand: 'right', finger: 1 }]);
    expect(play.active.has('right:1')).toBe(true);
    for (let i = 4; i <= 6; i++) play.push(frame(i * 33, hand('right', DOWN)));
    expect(cues[1]).toMatchObject({ kind: 'up', finger: 1 });
    expect(play.active.size).toBe(0);
  });
  it('ignores a one-frame flicker', () => {
    const cues: FingerCue[] = [];
    const play = createFingerPlay((c) => cues.push(c));
    play.push(frame(0, hand('left', DOWN)));
    play.push(frame(33, hand('left', INDEX)));
    play.push(frame(66, hand('left', DOWN)));
    play.push(frame(99, hand('left', DOWN)));
    expect(cues).toHaveLength(0);
  });
  it('a hand arriving with fingers up plays nothing, and leaving releases its notes', () => {
    const cues: FingerCue[] = [];
    const play = createFingerPlay((c) => cues.push(c));
    play.push(frame(0, hand('left', INDEX)));
    play.push(frame(33, hand('left', INDEX)));
    expect(cues).toHaveLength(0);
    play.push(frame(66, hand('left', DOWN)));
    play.push(frame(99, hand('left', DOWN)));
    play.push(frame(132, hand('left', DOWN)));
    for (let i = 5; i <= 7; i++) play.push(frame(i * 33, hand('left', INDEX)));
    expect(cues.filter((c) => c.kind === 'down')).toHaveLength(1);
    for (let i = 8; i <= 10; i++) play.push(frame(i * 33));
    expect(cues[cues.length - 1]).toMatchObject({ kind: 'up', hand: 'left', finger: 1 });
  });
  it('maps ten voices: chord roots on the left, pentatonic on the right, in key', () => {
    const v = voicesFor(0);
    expect(v.left.map((x) => x.label)).toEqual(['C', 'F', 'G', 'Am', 'Dm']);
    expect(v.right.map((x) => x.label)).toEqual(['C5', 'D5', 'E5', 'G5', 'A5']);
    const d = voicesFor(2);
    expect(d.left[0]?.label).toBe('D');
    expect(d.right[0]?.midi).toBe(74);
  });
});

describe('target coach', () => {
  const PERIOD = 1000;
  const follow = (coach: TargetCoach, beats: number, lagBeats = 0, wobble = 0) => {
    const out = [];
    for (let f = 0; f <= beats * 30; f++) {
      const b = f / 30;
      const g = guideAt(4, b - lagBeats);
      out.push(...coach.sample({ x: g.x + wobble, y: g.y }, b));
    }
    return out;
  };

  it('a hand that follows the guide exactly scores perfect on every beat, sideways ones included', () => {
    const coach = new TargetCoach(4, PERIOD);
    const results = follow(coach, 6);
    expect(results.length).toBeGreaterThanOrEqual(5);
    for (const r of results) expect(r.grade).toBe('perfect');
    expect(results.map((r) => r.beat).slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('arriving late costs timing but still reaches the target', () => {
    const coach = new TargetCoach(4, PERIOD);
    const results = follow(coach, 6, 0.2);
    const r = results[2];
    expect(r && r.offsetMs).toBeGreaterThan(150);
    expect(r && r.reach).toBeLessThan(0.02);
    expect(r && r.grade).not.toBe('perfect');
  });

  it('a hand far off the pattern misses, and no hand at all misses', () => {
    const far = follow(new TargetCoach(4, PERIOD), 4, 0, 0.6);
    for (const r of far) expect(r.grade).toBe('miss');
    const empty = new TargetCoach(4, PERIOD);
    const r = empty.sample(null, 2);
    expect(r.map((x) => x.beat)).toEqual([0, 1]);
    expect(r.every((x) => x.grade === 'miss')).toBe(true);
  });

  it('starts scoring after the count-in', () => {
    const coach = new TargetCoach(4, PERIOD);
    coach.startAt(4);
    expect(follow(coach, 5).every((r) => r.beat >= 4)).toBe(true);
  });

  it('score curves: inside the target is full marks, three radii is none', () => {
    expect(reachScore(0.05)).toBe(100);
    expect(reachScore(0.3)).toBe(0);
    expect(arrivalScore(40)).toBe(100);
    expect(arrivalScore(-400)).toBe(0);
  });
});
