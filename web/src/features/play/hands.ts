import type { LaneCount } from './lanes.js';

// The lane input layer: which lane a finger or key plays, and whether a
// finger's motion was a flick. Pure, so it is tested without a DOM.

/** Laptop keys per lane: two lanes split the home row, four take one finger each */
export const LANE_KEYS: Record<2 | 4, readonly (readonly string[])[]> = {
  2: [
    ['KeyD', 'KeyF'],
    ['KeyJ', 'KeyK'],
  ],
  4: [['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK']],
};

/** Key caps shown under each column */
export const KEY_CAPS: Record<2 | 4, readonly string[]> = { 2: ['F', 'J'], 4: ['D', 'F', 'J', 'K'] };

/** The lane a key plays, or null when the key plays nothing at this lane count */
export const keyLane = (code: string, count: LaneCount): number | null => {
  if (count === 1) return null;
  const lane = LANE_KEYS[count].findIndex((keys) => keys.includes(code));
  return lane < 0 ? null : lane;
};

/** Which of `count` equal vertical strips of a surface `x` landed in */
export const laneAt = (x: number, left: number, width: number, count: LaneCount): number => {
  if (count === 1 || width <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(((x - left) / width) * count)));
};

/** An upward swipe at least this far (CSS px) counts as a flick */
export const FLICK_PX = 24;
/** ...made within this long of the finger coming down */
export const FLICK_MS = 240;

/** A finger that moved `dx`, `dy` (screen px, y down) in `ms` since touching: was it a flick up? */
export const isFlick = (dx: number, dy: number, ms: number): boolean => ms <= FLICK_MS && -dy >= FLICK_PX && -dy > Math.abs(dx);
