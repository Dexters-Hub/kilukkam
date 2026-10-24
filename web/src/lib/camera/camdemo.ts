import type { Fingers, Point, TrackedHand } from './features.js';

// ?camdemo on the stage: a scripted conductor instead of the camera, for demos
// without a webcam and to prove every gesture reaches the room. It performs
// the whole vocabulary in order (seconds after the camera starts):
//
//    0    big beats at 120 bpm                  1 tempo: faster
//    8    small beats at 90 bpm                 1 tempo: slower
//   13    off-hand flat, lifted, then pressed   2 crescendo, then diminuendo
//   16    point left, hold                      3 the left section comes in
//   18    stop hand on the right, hold          4 the right section rests
//   20    both stop hands, hold                 5 the room pauses
//   21.5  one big downbeat                      6 the room counts in and plays on
//   23.5  both palms up, rising slowly          7 build
//   26    both hands sweep down fast            8 drop
//   28    off-hand traces a circle              9 loop the bar
//   31.2  the circle again                      9 back out of the loop
//   33    shake the hand like a bell           10 Kilukkam!
//   34.5  beats at 100 bpm                      1 tempo again
//   40    point right, hold                     3 the right section comes back in

export const CAMDEMO_MS = 41_600;

type Shape = 'relaxed' | 'stop' | 'flat' | 'point';

const FINGERS: Record<Shape, Fingers> = {
  relaxed: [false, false, false, false, false],
  stop: [true, true, true, true, true],
  flat: [true, true, true, true, true],
  point: [false, true, false, false, false],
};

const SIZE = 0.12;

const hand = (shape: Shape, p: Point, handedness: 'left' | 'right' = 'right'): TrackedHand => {
  // A flat hand points its fingers sideways, towards the middle; every other shape points them up.
  const flat = shape === 'flat';
  const towards = handedness === 'left' ? 1 : -1;
  return {
    handedness,
    score: 1,
    wrist: flat ? { x: p.x - 0.07 * towards, y: p.y } : { x: p.x, y: p.y + 0.08 },
    indexTip: flat ? { x: p.x + 0.12 * towards, y: p.y } : { x: p.x, y: p.y - 0.09 },
    palmCenter: p,
    size: SIZE,
    pinch: false,
    pinchDistance: 1,
    fingersUp: FINGERS[shape],
    openPalm: shape === 'stop' || flat,
    fist: false,
    landmarks: Array.from({ length: 21 }, () => p),
  };
};

/** Height of a beat pattern: a bounce at each ictus, `amp` tall below `top` */
const beatY = (e: number, bpm: number, top: number, amp: number): number => {
  const f = ((e * bpm) / 60_000) % 1;
  return top + amp * (1 - (2 * f - 1) ** 2);
};

const ramp = (e: number, from: number, ms: number, a: number, b: number): number => a + (b - a) * Math.min(1, Math.max(0, (e - from) / ms));

/** The off-hand traces a circle, one turn a second */
const circling = (e: number, from: number): TrackedHand[] => {
  const a = ((e - from) / 1000) * 2 * Math.PI;
  const tip = { x: 0.3 + 0.07 * Math.cos(a), y: 0.45 + 0.09 * Math.sin(a) };
  return [{ ...hand('point', { x: tip.x, y: tip.y + 0.09 }, 'left'), indexTip: tip }, hand('relaxed', { x: 0.72, y: 0.6 })];
};

/** The hands in view `e` ms after the camera started; null once the script is over */
export function demoHands(e: number): TrackedHand[] | null {
  if (e < 8000) return [hand('relaxed', { x: 0.62, y: beatY(e, 120, 0.3, 0.42) })];
  if (e < 13_000) return [hand('relaxed', { x: 0.62, y: beatY(e - 8000, 90, 0.5, 0.1) })];
  if (e < 16_000) {
    const y = e < 14_800 ? ramp(e, 13_600, 800, 0.65, 0.45) : ramp(e, 15_100, 800, 0.45, 0.65);
    return [hand('flat', { x: 0.25, y }, 'left'), hand('relaxed', { x: 0.65, y: beatY(e - 8000, 90, 0.5, 0.1) })];
  }
  if (e < 18_000) return [hand('point', { x: 0.15, y: 0.42 })];
  if (e < 20_000) return [hand('stop', { x: 0.85, y: 0.45 })];
  if (e < 21_500) return [hand('stop', { x: 0.3, y: 0.45 }, 'left'), hand('stop', { x: 0.7, y: 0.45 })];
  if (e < 23_500) {
    const y = e < 22_000 ? 0.3 : e < 22_250 ? ramp(e, 22_000, 250, 0.3, 0.75) : ramp(e, 22_250, 250, 0.75, 0.55);
    return [hand('relaxed', { x: 0.65, y })];
  }
  if (e < 26_000) {
    const y = ramp(e, 24_100, 1500, 0.75, 0.35);
    return [hand('flat', { x: 0.3, y }, 'left'), hand('flat', { x: 0.7, y })];
  }
  if (e < 28_000) {
    const y = ramp(e, 26_800, 250, 0.3, 0.78);
    return [hand('relaxed', { x: 0.3, y }, 'left'), hand('relaxed', { x: 0.7, y })];
  }
  if (e < 30_200) return circling(e, 28_000);
  if (e < 31_200) return [hand('relaxed', { x: 0.3, y: 0.6 }, 'left'), hand('relaxed', { x: 0.72, y: 0.6 })];
  if (e < 33_000) return circling(e, 31_200);
  if (e < 34_500) return [hand('relaxed', { x: 0.55 + 0.04 * Math.sin(((e - 33_000) / 250) * 2 * Math.PI), y: 0.5 })];
  if (e < 40_000) return [hand('relaxed', { x: 0.62, y: beatY(e - 34_500, 100, 0.3, 0.3) })];
  if (e < CAMDEMO_MS) return [hand('point', { x: 0.85, y: 0.42 })];
  return null;
}
