import type { Point } from './features.js';

/*
 * Conducting patterns: the shape a baton traces for each time signature, the
 * guide position at any moment, and how closely a conductor's hand follows it.
 *
 * Every pattern is a loop through one "ictus" point per beat (where the beat
 * lands, at the bottom of a small bounce), drawn as a smooth Catmull-Rom curve
 * so the guide moves like a real baton: it accelerates into each ictus and
 * floats out of it. Coordinates live in a unit box (x right, y down, 0..1)
 * that the caller places over the conductor's own hand area, so the shape fits
 * whoever is conducting, near or far from the camera.
 *
 * Accuracy has two parts, scored per beat:
 *  - shape: the mean distance between the palm and the guide over the beat,
 *    in box widths, mapped so 0.05 or closer is 100 and 0.35 or further is 0;
 *  - timing: how far the hand's own ictus lands from the beat, in ms, using
 *    the same windows as the tap judge.
 * A beat's score is 60% timing and 40% shape: landing on time is what the
 * room hears, the shape is what keeps it readable.
 */

/** Ictus points for each meter, in beat order (unit box, y down). */
export const PATTERNS: Readonly<Record<2 | 3 | 4, readonly Point[]>> = {
  // 2/4: down, then up.
  2: [
    { x: 0.5, y: 0.88 },
    { x: 0.56, y: 0.3 },
  ],
  // 3/4: down, out to the right, up.
  3: [
    { x: 0.48, y: 0.88 },
    { x: 0.86, y: 0.66 },
    { x: 0.52, y: 0.22 },
  ],
  // 4/4: down, in to the left, out to the right, up.
  4: [
    { x: 0.5, y: 0.88 },
    { x: 0.16, y: 0.64 },
    { x: 0.86, y: 0.66 },
    { x: 0.52, y: 0.2 },
  ],
};

export type Meter = keyof typeof PATTERNS;

/** The pattern for a time signature: 2, 3 or 4 directly; 6 conducts in 2, others fall back to 4. */
export const meterFor = (beatsPerBar: number): Meter =>
  beatsPerBar === 2 || beatsPerBar === 6 ? 2 : beatsPerBar === 3 ? 3 : 4;

const catmullRom = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
};

/**
 * Where the baton should be `beat` beats into the bar (fractional, wraps).
 * Each beat travels from its ictus to the next one, easing in so the hand
 * arrives a little faster, the way a conductor "drops" into the beat.
 */
export const guideAt = (meter: Meter, beat: number): Point => {
  const pts = PATTERNS[meter];
  const n = pts.length;
  const b = ((beat % n) + n) % n;
  const i = Math.floor(b);
  const frac = b - i;
  // Ease: slow out of the ictus, faster into the next one.
  const t = frac * frac * (3 - 2 * frac) * 0.4 + frac * 0.6;
  const at = (k: number) => pts[((k % n) + n) % n] as Point;
  return catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), t);
};

/** A polyline of the whole pattern for drawing the guide, `steps` points per beat. */
export const guidePath = (meter: Meter, steps = 24): Point[] => {
  const n = PATTERNS[meter].length;
  const out: Point[] = [];
  for (let k = 0; k <= n * steps; k++) out.push(guideAt(meter, k / steps));
  return out;
};

/** The square the pattern is drawn in, in frame coordinates. */
export interface GuideBox {
  x: number;
  y: number;
  size: number;
}

/** Place the pattern box around where the hand naturally sits: centred on it, `scale` frame heights tall. */
export const boxAround = (center: Point, aspect: number, scale = 0.5): GuideBox => {
  const size = scale;
  const half = size / 2;
  // x is in frame widths, so a square box is narrower in x by the aspect ratio.
  const w = size / aspect;
  return { x: Math.min(1 - w, Math.max(0, center.x - w / 2)), y: Math.min(1 - size, Math.max(0, center.y - half)), size };
};

/** Unit-box point to frame point, and back. */
export const toFrame = (p: Point, box: GuideBox, aspect: number): Point => ({ x: box.x + (p.x * box.size) / aspect, y: box.y + p.y * box.size });
export const toBox = (p: Point, box: GuideBox, aspect: number): Point => ({ x: ((p.x - box.x) * aspect) / box.size, y: (p.y - box.y) / box.size });

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Shape score for one beat: mean palm-to-guide distance (box widths) mapped to 0..100. */
export const shapeScore = (meanDistance: number): number => Math.round(100 * clamp01((0.35 - meanDistance) / 0.3));

/** Timing score for one beat, in line with the tap judge: within 50 ms is 100, 300 ms or more is 0. */
export const timingScore = (offsetMs: number): number => Math.round(100 * clamp01((300 - Math.abs(offsetMs)) / 250));

export type BatonGrade = 'perfect' | 'great' | 'good' | 'miss';

export const batonGrade = (score: number): BatonGrade => (score >= 85 ? 'perfect' : score >= 65 ? 'great' : score >= 40 ? 'good' : 'miss');

/**
 * Collects palm samples against the guide and scores each beat. Feed it every
 * frame with the beat position from the shared grid; call `ictus` when the
 * baton tracker reports a downstroke bottom.
 */
export class PatternCoach {
  private distSum = 0;
  private distN = 0;
  private lastBeat = Number.NaN;
  private pendingOffset: number | null = null;
  private scores: number[] = [];

  constructor(private readonly meter: Meter) {}

  /** One frame: the palm in unit-box coordinates at fractional beat `beat`. Returns a finished beat's result. */
  sample(palm: Point, beat: number): { beat: number; score: number; grade: BatonGrade; shape: number; timing: number } | null {
    const g = guideAt(this.meter, beat);
    this.distSum += Math.hypot(palm.x - g.x, palm.y - g.y);
    this.distN++;
    const whole = Math.floor(beat);
    if (Number.isNaN(this.lastBeat)) this.lastBeat = whole;
    if (whole === this.lastBeat) return null;
    const shape = shapeScore(this.distSum / Math.max(1, this.distN));
    const timing = this.pendingOffset === null ? 0 : timingScore(this.pendingOffset);
    const score = Math.round(0.6 * timing + 0.4 * shape);
    const done = { beat: this.lastBeat, score, grade: batonGrade(score), shape, timing };
    this.scores.push(score);
    this.distSum = 0;
    this.distN = 0;
    this.pendingOffset = null;
    this.lastBeat = whole;
    return done;
  }

  /** The hand's own ictus landed `offsetMs` from the nearest beat (negative is early). */
  ictus(offsetMs: number): void {
    if (this.pendingOffset === null || Math.abs(offsetMs) < Math.abs(this.pendingOffset)) this.pendingOffset = offsetMs;
  }

  /** Running baton accuracy, 0..100, over the scored beats. */
  get accuracy(): number {
    return this.scores.length ? Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length) : 0;
  }

  get beatsScored(): number {
    return this.scores.length;
  }
}
