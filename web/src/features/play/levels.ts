import type { LaneCount } from './lanes.js';

// Difficulty levels for the play screen, and the one this phone remembers.

export type Level = 'easy' | 'normal' | 'hard' | 'expert';

export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard', 'expert'];
export const DEFAULT_LEVEL: Level = 'normal';
export const LEVEL_PREF = 'kilukkam.level';

export const LEVEL_NAME: Record<Level, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };

export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

export const laneCount = (level: Level): LaneCount => (level === 'easy' ? 1 : level === 'normal' ? 2 : 4);

/** Beats of tiles visible above the hit zone: Expert scrolls faster */
export const lookahead = (level: Level): number => (level === 'expert' ? 3 : 4);

/** Expert adds hold and flick notes */
export const noteTypes = (level: Level): boolean => level === 'expert';

type Prefs = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): Prefs | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The saved level, or Normal when nothing (or nothing valid) is saved or storage is blocked */
export const loadLevel = (prefs: Prefs | null = storage()): Level => {
  try {
    const saved = prefs?.getItem(LEVEL_PREF);
    return isLevel(saved) ? saved : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
};

export const saveLevel = (level: Level, prefs: Prefs | null = storage()): void => {
  try {
    prefs?.setItem(LEVEL_PREF, level);
  } catch {
    // private mode or storage blocked: the level just doesn't stick
  }
};
