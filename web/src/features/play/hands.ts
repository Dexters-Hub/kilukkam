import type { LaneSide } from '../../lib/lane.js';

// The two-hands input layer: turns left and right presses (fingers or keys)
// into hits. A chord waits a moment for the other hand; everything else
// fires at once so the note sounds on touch.

export type Hand = 'left' | 'right';

/** Both hands within this many ms of each other make a chord */
export const CHORD_MS = 60;

export const LEFT_KEYS: ReadonlySet<string> = new Set(['KeyF', 'KeyD']);
export const RIGHT_KEYS: ReadonlySet<string> = new Set(['KeyJ', 'KeyK']);

export const keyHand = (code: string): Hand | null => (LEFT_KEYS.has(code) ? 'left' : RIGHT_KEYS.has(code) ? 'right' : null);

/** Which half of a surface `x` landed on */
export const sideOf = (x: number, left: number, width: number): Hand => (x < left + width / 2 ? 'left' : 'right');

export interface Hands {
  /** A hand came down at `at` (ms on the same clock as `now`) */
  press(hand: Hand, at: number): void;
  /** Drop a half-made chord without firing it */
  cancel(): void;
}

/**
 * `want` names the lane of the next note; `fire` gets the hit and how many ms
 * ago the first hand came down, so a chord is judged from its first finger.
 */
export function createHands(want: () => LaneSide | null, fire: (hit: LaneSide, lateMs: number) => void, now: () => number = () => performance.now()): Hands {
  let pending: { hand: Hand; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    return p;
  };
  const flush = () => {
    const p = clear();
    if (p) fire(p.hand, Math.max(0, now() - p.at));
  };
  return {
    press(hand, at) {
      if (pending) {
        if (hand !== pending.hand && at - pending.at <= CHORD_MS) {
          const p = clear() as { at: number };
          fire('both', Math.max(0, now() - p.at));
          return;
        }
        flush();
      }
      if (want() === 'both') {
        pending = { hand, at };
        timer = setTimeout(flush, CHORD_MS);
        return;
      }
      fire(hand, Math.max(0, now() - at));
    },
    cancel: () => {
      clear();
    },
  };
}
