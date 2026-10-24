import { analyseHand, type HandFrame, type Handedness, type Point, type TrackedHand } from '../src/lib/camera/features.js';

// Synthetic hands for tests. A hand is built in its own units (wrist to
// middle knuckle = 1, palm facing the camera, fingers up), each finger bent
// at its three joints by the given angles towards the camera, projected onto
// the image, then rotated, scaled and placed in the frame. The result goes
// through analyseHand, exactly as real MediaPipe landmarks do.

export const ASPECT = 4 / 3;
export const FPS = 30;

/** Bend at the knuckle, middle and end joints, in degrees */
export type Curl = readonly [number, number, number];

export const STRAIGHT: Curl = [5, 5, 5];
export const RELAXED: Curl = [30, 40, 20];
export const CURLED: Curl = [80, 100, 60];

export interface Pose {
  /** Thumb out to the side (true) or folded across the palm */
  thumbOut: boolean;
  /** Index, middle, ring, pinky */
  fingers: readonly [Curl, Curl, Curl, Curl];
  /** Put the thumb tip on the index tip */
  pinch?: boolean;
}

export const POSES = {
  open: { thumbOut: true, fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT] },
  fist: { thumbOut: false, fingers: [CURLED, CURLED, CURLED, CURLED] },
  point: { thumbOut: false, fingers: [STRAIGHT, CURLED, CURLED, CURLED] },
  relaxed: { thumbOut: true, fingers: [RELAXED, RELAXED, RELAXED, RELAXED] },
  pinch: { thumbOut: true, fingers: [[35, 40, 20], STRAIGHT, STRAIGHT, STRAIGHT], pinch: true },
} satisfies Record<string, Pose>;

/** Fingers (index..pinky) up or curled; thumb out or in */
export const fingersPose = (thumb: boolean, up: readonly [boolean, boolean, boolean, boolean]): Pose => ({
  thumbOut: thumb,
  fingers: [up[0] ? STRAIGHT : CURLED, up[1] ? STRAIGHT : CURLED, up[2] ? STRAIGHT : CURLED, up[3] ? STRAIGHT : CURLED],
});

// Knuckle positions (x right, y down, wrist at the origin) and bone lengths.
const KNUCKLES: readonly Point[] = [
  { x: -0.3, y: -0.95 },
  { x: -0.08, y: -1 },
  { x: 0.13, y: -0.95 },
  { x: 0.32, y: -0.85 },
];
const BONES: readonly (readonly [number, number, number])[] = [
  [0.45, 0.27, 0.22],
  [0.5, 0.3, 0.24],
  [0.46, 0.28, 0.22],
  [0.36, 0.22, 0.2],
];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Landmarks in hand units */
export function localLandmarks(pose: Pose): Point[] {
  const pts: Point[] = new Array<Point>(21).fill({ x: 0, y: 0 });
  pts[0] = { x: 0, y: 0 };
  // Thumb: from the base of the palm, out to the side or folded inward.
  const thumbBase = { x: -0.22, y: -0.28 };
  const thumbBones = [0.32, 0.28, 0.24];
  let dir = rad(-55); // from straight up, negative leans towards the index side
  const fold = pose.thumbOut ? [0, 5, 5] : [55, 45, 40];
  let p = thumbBase;
  pts[1] = p;
  thumbBones.forEach((len, i) => {
    dir += rad(fold[i] ?? 0);
    p = { x: p.x + Math.sin(dir) * len, y: p.y - Math.cos(dir) * len };
    pts[2 + i] = p;
  });
  pose.fingers.forEach((curl, f) => {
    const base = KNUCKLES[f] ?? { x: 0, y: -1 };
    const len = Math.hypot(base.x, base.y);
    const ux = base.x / len;
    const uy = base.y / len;
    const bones = BONES[f] ?? [0.4, 0.25, 0.2];
    let q = base;
    pts[5 + f * 4] = q;
    let cum = 0;
    bones.forEach((b, j) => {
      cum += rad(curl[j] ?? 0);
      // Bending towards the camera: the bone's projected length shrinks with cos, then folds back.
      const proj = Math.cos(cum) * b;
      q = { x: q.x + ux * proj, y: q.y + uy * proj };
      pts[6 + f * 4 + j] = q;
    });
  });
  if (pose.pinch) {
    const tip = pts[8] ?? { x: 0, y: 0 };
    pts[4] = { x: tip.x - 0.05, y: tip.y + 0.04 };
    const ip = pts[3] ?? tip;
    pts[3] = { x: (ip.x + tip.x) / 2 - 0.1, y: (ip.y + tip.y) / 2 + 0.1 };
  }
  return pts;
}

/** Seeded noise so jitter tests are repeatable */
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
};

export interface Placement {
  /** Palm centre in the frame, normalised (as the conductor will see it, after mirroring) */
  x?: number;
  y?: number;
  /** Hand size in frame heights */
  size?: number;
  /** Degrees, positive turns the fingers towards the right of the frame */
  rotate?: number;
  handedness?: Handedness;
  /** Landmark noise, normalised units (0.002 is about 1.3 px at 640x480) */
  noise?: number;
  random?: () => number;
}

/** A tracked hand, built from a pose, as analyseHand would report it */
export function makeHand(pose: Pose, at: Placement = {}): TrackedHand {
  const size = at.size ?? 0.12;
  const rot = rad(at.rotate ?? 0);
  const local = localLandmarks(pose);
  const palmIdx = [0, 5, 9, 13, 17];
  const pcx = palmIdx.reduce((s, i) => s + (local[i]?.x ?? 0), 0) / palmIdx.length;
  const pcy = palmIdx.reduce((s, i) => s + (local[i]?.y ?? 0), 0) / palmIdx.length;
  const cx = (at.x ?? 0.5) * ASPECT;
  const cy = at.y ?? 0.5;
  const noise = at.noise ?? 0;
  const rand = at.random ?? Math.random;
  const placed = local.map((p) => {
    const dx = p.x - pcx;
    const dy = p.y - pcy;
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    return { x: (cx + rx * size) / ASPECT + noise * rand(), y: cy + ry * size + noise * rand() };
  });
  // Undo the mirroring analyseHand applies, and give MediaPipe's (selfie) label.
  const raw = placed.map((p) => ({ x: 1 - p.x, y: p.y }));
  const label = (at.handedness ?? 'right') === 'right' ? 'Left' : 'Right';
  const hand = analyseHand(raw, label, 0.95, { aspect: ASPECT, mirror: true });
  if (!hand) throw new Error('fixture made fewer than 21 landmarks');
  return hand;
}

export const frame = (t: number, ...hands: TrackedHand[]): HandFrame => ({ t, aspect: ASPECT, hands });

/** Camera timestamps at `fps` with a little scheduling jitter */
export function* clock(ms: number, opts: { fps?: number; jitter?: number; start?: number; random?: () => number } = {}): Generator<number> {
  const step = 1000 / (opts.fps ?? FPS);
  const rand = opts.random ?? (() => 0);
  const start = opts.start ?? 0;
  for (let i = 0; i * step <= ms; i++) yield start + i * step + (opts.jitter ?? 0) * rand();
}

/**
 * A conductor's beat: the hand falls to a sharp bounce at the ictus and
 * floats up again, `amp` frame heights tall. Phase 0 is the ictus.
 */
export const bounceY = (t: number, bpm: number, amp: number, top = 0.35): number => {
  const phase = (t % (60_000 / bpm)) / (60_000 / bpm);
  return top + amp * (1 - Math.abs(Math.sin(Math.PI * phase)));
};
