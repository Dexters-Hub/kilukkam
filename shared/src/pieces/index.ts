import { canonInD } from './canon-in-d.js';
import { odeToJoy } from './ode-to-joy.js';
import type { Score } from '../score.js';

export { canonInD, odeToJoy };

export const PIECES: readonly Score[] = [canonInD, odeToJoy];

export function getPiece(id: string): Score | undefined {
  return PIECES.find((p) => p.id === id);
}
