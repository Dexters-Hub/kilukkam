import { describe, expect, it } from 'vitest';
import type { HandFrame, Point, TrackedHand } from '../src/lib/camera/features.js';
import { TOUCH, createTouchPlay, touchedFinger, type TouchCue } from '../src/lib/camera/touch.js';

// A hand of size 0.2 with the four fingertips spread out, and the thumb tip
// placed wherever the test wants it.
const TIPS: Point[] = [
  { x: 0.4, y: 0.2 },
  { x: 0.5, y: 0.15 },
  { x: 0.6, y: 0.2 },
  { x: 0.7, y: 0.3 },
];
const handWithThumb = (thumb: Point, handedness: 'left' | 'right' = 'right'): TrackedHand => {
  const lms: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
  lms[4] = thumb;
  lms[8] = TIPS[0] as Point;
  lms[12] = TIPS[1] as Point;
  lms[16] = TIPS[2] as Point;
  lms[20] = TIPS[3] as Point;
  return {
    handedness, score: 1, wrist: { x: 0.5, y: 0.7 }, indexTip: lms[8] as Point, palmCenter: { x: 0.5, y: 0.5 }, size: 0.2,
    pinch: false, pinchDistance: 1, fingersUp: [true, true, true, true, true], openPalm: true, fist: false, landmarks: lms,
  };
};
const frame = (t: number, hands: TrackedHand[]): HandFrame => ({ t, aspect: 1, hands });
const near = (i: number): Point => ({ x: (TIPS[i]?.x ?? 0) + 0.01, y: (TIPS[i]?.y ?? 0) + 0.01 });
const away: Point = { x: 0.2, y: 0.8 };

describe('touch play', () => {
  it('picks only the clearly nearest fingertip', () => {
    expect(touchedFinger([0.05, 0.6, 0.9, 1.2], null)).toBe(0);
    // Two tips about equally close: ambiguous, so no note at all.
    expect(touchedFinger([0.2, 0.22, 0.9, 1.2], null)).toBeNull();
    expect(touchedFinger([0.5, 0.6, 0.9, 1.2], null)).toBeNull();
  });

  it('holds a sounding note until the touch clearly parts (hysteresis)', () => {
    expect(touchedFinger([TOUCH.on + 0.05, 0.9, 0.9, 0.9], 0)).toBe(0);
    expect(touchedFinger([TOUCH.off + 0.05, 0.9, 0.9, 0.9], 0)).toBeNull();
  });

  it('plays on a confirmed touch, releases on parting, and switches fingers cleanly', () => {
    const cues: TouchCue[] = [];
    const play = createTouchPlay((c) => cues.push(c));
    let t = 0;
    const step = (thumb: Point, n = 1) => {
      for (let i = 0; i < n; i++) play.push(frame((t += 33), [handWithThumb(thumb)]));
    };
    step(away, 2);
    step(near(2), 1);
    expect(cues).toEqual([]);
    step(near(2), 1);
    expect(cues.map((c) => `${c.kind}${c.finger}`)).toEqual(['down2']);
    step(near(0), 2);
    expect(cues.map((c) => `${c.kind}${c.finger}`)).toEqual(['down2', 'up2', 'down0']);
    step(away, 2);
    expect(cues.map((c) => `${c.kind}${c.finger}`)).toEqual(['down2', 'up2', 'down0', 'up0']);
    expect(play.active.size).toBe(0);
  });

  it('ignores a hand that appears already touching until it lets go once', () => {
    const cues: TouchCue[] = [];
    const play = createTouchPlay((c) => cues.push(c));
    for (let i = 0; i < 4; i++) play.push(frame(i * 33, [handWithThumb(near(1))]));
    expect(cues).toEqual([]);
  });

  it('a single jittery frame does not play', () => {
    const cues: TouchCue[] = [];
    const play = createTouchPlay((c) => cues.push(c));
    const seq = [away, away, near(3), away, away];
    seq.forEach((p, i) => play.push(frame(i * 33, [handWithThumb(p)])));
    expect(cues).toEqual([]);
  });

  it('releases the note when the hand leaves the picture', () => {
    const cues: TouchCue[] = [];
    const play = createTouchPlay((c) => cues.push(c));
    [away, near(1), near(1)].forEach((p, i) => play.push(frame(i * 33, [handWithThumb(p)])));
    for (let i = 0; i < TOUCH.lostFrames; i++) play.push(frame(200 + i * 33, []));
    expect(cues.map((c) => c.kind)).toEqual(['down', 'up']);
  });
});

describe('which hand is which', () => {
  it('goes by position in the mirrored picture, never two of the same', async () => {
    const { assignSides } = await import('../src/lib/camera/features.js');
    const at = (x: number, label: 'left' | 'right') => ({ ...handWithThumb(away, label), palmCenter: { x, y: 0.5 } });
    // MediaPipe called both hands "right": position still splits them.
    const two = assignSides([at(0.8, 'right'), at(0.25, 'right')]);
    expect(two.map((h) => `${h.palmCenter.x}:${h.handedness}`)).toEqual(['0.25:left', '0.8:right']);
    // A wrong label on one hand: its side of the picture wins.
    expect(assignSides([at(0.2, 'right')])[0]?.handedness).toBe('left');
    expect(assignSides([at(0.7, 'left')])[0]?.handedness).toBe('right');
  });
});

describe('hit names', () => {
  it('names drum hits, and pitches for everything else', async () => {
    const { hitName } = await import('../src/lib/music.js');
    expect(hitName('drums', 36)).toBe('Kick');
    expect(hitName('drums', 38)).toBe('Snare');
    expect(hitName('drums', 42)).toBe('Hat');
    expect(hitName('violin', 60)).toBe('C4');
  });
});
