// Hand landmarks in, hand features out. Pure maths, no camera and no
// MediaPipe import, so it runs in unit tests and in the tracking loop alike.
//
// Coordinates are normalised to the frame (0..1 on both axes, y down), as
// MediaPipe gives them. Distances are measured in an isotropic space where
// x is stretched by the frame's aspect ratio, so "far" means the same thing
// horizontally and vertically. Every distance threshold is then divided by
// the hand's own size, which makes the gestures work at any distance from
// the camera.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The person's real hand, already corrected for the selfie camera. */
export type Handedness = 'left' | 'right';

/** Thumb, index, middle, ring, pinky */
export type Fingers = readonly [boolean, boolean, boolean, boolean, boolean];

export interface TrackedHand {
  handedness: Handedness;
  /** MediaPipe's confidence in the handedness label, 0 to 1 */
  score: number;
  wrist: Point;
  indexTip: Point;
  /** Mean of the wrist and the four knuckles: steadier than any one point */
  palmCenter: Point;
  /** Hand size in frame heights (wrist to middle knuckle, foreshortening corrected) */
  size: number;
  /** Thumb tip touching the index tip */
  pinch: boolean;
  /** Thumb tip to index tip, in hand sizes */
  pinchDistance: number;
  fingersUp: Fingers;
  /** All five fingers extended */
  openPalm: boolean;
  /** All four fingers tightly curled (the thumb may sit anywhere) */
  fist: boolean;
  /** All 21 landmarks, for drawing */
  landmarks: readonly Point[];
}

export interface HandFrame {
  /** ms, performance.now() clock */
  t: number;
  /** Frame width over height, to measure distances in one unit */
  aspect: number;
  hands: readonly TrackedHand[];
}

/** MediaPipe hand landmark indices */
export const LM = {
  wrist: 0,
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;

/** Bones to draw between landmarks (the standard 21 point hand topology) */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * Thresholds, all ratios so they hold at any distance from the camera.
 *
 * A finger is up when its tip is clearly farther from the wrist than its
 * middle joint: a straight finger measures about 1.3, a relaxed one about
 * 1.05, a curled one under 0.7. Up needs 1.15, a fist needs every finger
 * under 0.9, so a loosely hanging hand is neither (it must not end the piece).
 * The thumb bends sideways, so it is measured against the pinky knuckle.
 * A pinch is thumb tip to index tip under a third of a hand: touching tips
 * measure 0.1 to 0.25, an open hand 0.8 and up.
 */
export const FEATURE = {
  fingerUp: 1.15,
  fingerCurled: 0.9,
  thumbUp: 1.1,
  pinch: 0.33,
  /** Palm width (index to pinky knuckle) to palm length, for the size estimate */
  palmWidthToLength: 0.8,
} as const;

const dist = (a: Point, b: Point, aspect: number): number => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

const at = (lms: readonly Point[], i: number): Point => lms[i] ?? { x: 0, y: 0 };

/**
 * Hand size in frame heights. The palm's length shrinks when the hand tips
 * towards the camera and its width shrinks when it turns sideways; taking
 * the larger of the two keeps the size steady through both.
 */
export const handSize = (lms: readonly Point[], aspect: number): number => {
  const length = dist(at(lms, LM.wrist), at(lms, LM.middle[0]), aspect);
  const width = dist(at(lms, LM.index[0]), at(lms, LM.pinky[0]), aspect) / FEATURE.palmWidthToLength;
  return Math.max(length, width, 1e-6);
};

/** Tip distance over middle joint distance, from the wrist: about 1.3 straight, under 0.7 curled */
export const fingerReach = (lms: readonly Point[], finger: readonly [number, number, number, number], aspect: number): number => {
  const wrist = at(lms, LM.wrist);
  return dist(wrist, at(lms, finger[3]), aspect) / Math.max(1e-6, dist(wrist, at(lms, finger[1]), aspect));
};

/** Thumb tip against its last joint, both measured from the pinky knuckle */
export const thumbReach = (lms: readonly Point[], aspect: number): number => {
  const anchor = at(lms, LM.pinky[0]);
  return dist(anchor, at(lms, LM.thumb[3]), aspect) / Math.max(1e-6, dist(anchor, at(lms, LM.thumb[2]), aspect));
};

export interface AnalyseOptions {
  /** Frame width over height */
  aspect: number;
  /** Flip x so coordinates match a mirrored (selfie) preview */
  mirror: boolean;
}

/**
 * Features for one detected hand. `label` is MediaPipe's handedness, which
 * assumes a mirrored image; the tracker feeds it the raw camera frame, so the
 * label names the opposite hand and is swapped here.
 */
export function analyseHand(raw: readonly Point[], label: string, score: number, opts: AnalyseOptions): TrackedHand | null {
  if (raw.length < 21) return null;
  const { aspect } = opts;
  const lms = opts.mirror ? raw.map((p) => ({ x: 1 - p.x, y: p.y })) : raw.map((p) => ({ x: p.x, y: p.y }));
  const size = handSize(lms, aspect);
  const reach = (f: readonly [number, number, number, number]) => fingerReach(lms, f, aspect);
  const fingers = [LM.index, LM.middle, LM.ring, LM.pinky].map(reach);
  const fingersUp: Fingers = [
    thumbReach(lms, aspect) > FEATURE.thumbUp,
    (fingers[0] ?? 0) > FEATURE.fingerUp,
    (fingers[1] ?? 0) > FEATURE.fingerUp,
    (fingers[2] ?? 0) > FEATURE.fingerUp,
    (fingers[3] ?? 0) > FEATURE.fingerUp,
  ];
  const pinchDistance = dist(at(lms, LM.thumb[3]), at(lms, LM.index[3]), aspect) / size;
  const knuckles = [LM.wrist, LM.index[0], LM.middle[0], LM.ring[0], LM.pinky[0]].map((i) => at(lms, i));
  const palmCenter = {
    x: knuckles.reduce((s, p) => s + p.x, 0) / knuckles.length,
    y: knuckles.reduce((s, p) => s + p.y, 0) / knuckles.length,
  };
  return {
    handedness: label.toLowerCase() === 'left' ? 'right' : 'left',
    score,
    wrist: at(lms, LM.wrist),
    indexTip: at(lms, LM.index[3]),
    palmCenter,
    size,
    pinch: pinchDistance < FEATURE.pinch,
    pinchDistance,
    fingersUp,
    openPalm: fingersUp.every(Boolean),
    fist: fingers.every((r) => r < FEATURE.fingerCurled),
    landmarks: lms,
  };
}

/**
 * Which hand is which, from where it is in the (mirrored) picture, not from
 * MediaPipe's label: the label can flip between frames and often calls both
 * hands "Right", which would make two hands share one voice. In a selfie view
 * your left hand is on the left, so with two hands the further left is the
 * left hand, and a single hand is the left one on the left half.
 */
export const assignSides = (hands: readonly TrackedHand[]): TrackedHand[] => {
  if (hands.length === 0) return [];
  if (hands.length === 1) {
    const [h] = hands as [TrackedHand];
    return [{ ...h, handedness: h.palmCenter.x < 0.5 ? 'left' : 'right' }];
  }
  const [a, b, ...rest] = [...hands].sort((x, y) => x.palmCenter.x - y.palmCenter.x) as [TrackedHand, TrackedHand, ...TrackedHand[]];
  return [{ ...a, handedness: 'left' }, { ...b, handedness: 'right' }, ...rest];
};
