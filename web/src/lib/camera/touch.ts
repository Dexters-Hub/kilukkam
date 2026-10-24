import { LM, type HandFrame, type Handedness, type Point, type TrackedHand } from './features.js';

/*
 * Touch play: tap your thumb to a fingertip to play that finger's note, keep
 * the touch to hold it, part them to let go. Four voices a hand.
 *
 * Why touches and not raised fingers: the ring finger cannot lift on its own
 * (its tendons are tied to its neighbours), so "finger up" fires the wrong
 * notes. Thumb to fingertip is a distance between two tips, measured in hand
 * sizes, and every finger can make it alone, so it stays accurate.
 *
 * Accuracy rules, applied every frame per hand:
 *  - only the fingertip nearest the thumb can sound, and it must be clearly
 *    nearer than the runner up (NEAREST_RATIO), so a ring touch never plays
 *    the pinky;
 *  - hysteresis: a touch starts under TOUCH_ON hand sizes and ends only past
 *    TOUCH_OFF, so a held note does not flicker;
 *  - a change needs CONFIRM agreeing frames;
 *  - a hand that appears already touching only sets the baseline.
 */

export const TOUCH = {
  on: 0.28,
  off: 0.42,
  nearestRatio: 0.72,
  confirm: 2,
  /** Frames a hand may vanish before its note is released */
  lostFrames: 6,
} as const;

/** Index, middle, ring, little finger: the four fingers the thumb can touch */
export const TOUCH_FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;
const TIPS = [LM.index[3], LM.middle[3], LM.ring[3], LM.pinky[3]] as const;

export type TouchCue = { kind: 'down' | 'up'; t: number; hand: Handedness; finger: number };

const dist = (a: Point, b: Point, aspect: number): number => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Thumb tip to each fingertip, in hand sizes (index first). */
export const tipDistances = (hand: TrackedHand, aspect: number): number[] => {
  const thumb = hand.landmarks[LM.thumb[3]];
  if (!thumb) return [Infinity, Infinity, Infinity, Infinity];
  return TIPS.map((i) => {
    const tip = hand.landmarks[i];
    return tip ? dist(thumb, tip, aspect) / Math.max(1e-6, hand.size) : Infinity;
  });
};

/**
 * Which finger the thumb is touching right now, or null. `held` is the
 * finger already sounding, which keeps its note until it passes TOUCH_OFF.
 */
export const touchedFinger = (d: readonly number[], held: number | null): number | null => {
  if (held !== null && (d[held] ?? Infinity) < TOUCH.off) return held;
  let best = -1;
  let second = Infinity;
  d.forEach((v, i) => {
    if (best < 0 || v < (d[best] ?? Infinity)) {
      if (best >= 0) second = Math.min(second, d[best] ?? Infinity);
      best = i;
    } else second = Math.min(second, v);
  });
  const nearest = d[best] ?? Infinity;
  if (best < 0 || nearest >= TOUCH.on) return null;
  return nearest <= second * TOUCH.nearestRatio ? best : null;
};

export interface TouchPlay {
  push(frame: HandFrame): void;
  reset(): void;
  /** Sounding touches, as "left:0" keys (finger 0 is the index) */
  readonly active: ReadonlySet<string>;
  /** Thumb to fingertip distances from the last frame, for drawing */
  readonly distances: ReadonlyMap<Handedness, readonly number[]>;
}

export const touchKey = (hand: Handedness, finger: number): string => `${hand}:${finger}`;

export function createTouchPlay(onCue: (cue: TouchCue) => void): TouchPlay {
  const state = new Map<Handedness, { held: number | null; pending: number | null; count: number; missing: number; armed: boolean }>();
  const active = new Set<string>();
  const distances = new Map<Handedness, readonly number[]>();

  const release = (hand: Handedness, t: number) => {
    const s = state.get(hand);
    if (s?.held !== null && s?.held !== undefined) {
      active.delete(touchKey(hand, s.held));
      onCue({ kind: 'up', t, hand, finger: s.held });
      s.held = null;
    }
  };

  return {
    push(frame) {
      const seen = new Set<Handedness>();
      for (const hand of frame.hands) {
        seen.add(hand.handedness);
        const d = tipDistances(hand, frame.aspect);
        distances.set(hand.handedness, d);
        let s = state.get(hand.handedness);
        if (!s) {
          // First sight: whatever it is doing now is the baseline, not a note.
          s = { held: null, pending: null, count: 0, missing: 0, armed: touchedFinger(d, null) === null };
          state.set(hand.handedness, s);
          continue;
        }
        s.missing = 0;
        const now = touchedFinger(d, s.held);
        if (!s.armed) {
          if (now === null) s.armed = true;
          continue;
        }
        if (now === s.held) {
          s.pending = null;
          s.count = 0;
          continue;
        }
        if (now !== s.pending) {
          s.pending = now;
          s.count = 1;
        } else s.count++;
        if (s.count < TOUCH.confirm) continue;
        release(hand.handedness, frame.t);
        if (now !== null) {
          s.held = now;
          active.add(touchKey(hand.handedness, now));
          onCue({ kind: 'down', t: frame.t, hand: hand.handedness, finger: now });
        }
        s.pending = null;
        s.count = 0;
      }
      for (const [hand, s] of state) {
        if (seen.has(hand)) continue;
        distances.delete(hand);
        if (++s.missing >= TOUCH.lostFrames) {
          release(hand, frame.t);
          state.delete(hand);
        }
      }
    },
    reset() {
      state.clear();
      active.clear();
      distances.clear();
    },
    get active() {
      return active;
    },
    get distances() {
      return distances;
    },
  };
}
