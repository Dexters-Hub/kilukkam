import { canonInD } from './canon-in-d.js';
import { odeToJoy } from './ode-to-joy.js';
import { ORIGINALS, bossRush, hallowedDepths, pixelPlains } from './originals/index.js';
import type { Score } from '../score.js';

export { canonInD, odeToJoy, hallowedDepths, bossRush, pixelPlains, ORIGINALS };

export const PIECES: readonly Score[] = [canonInD, odeToJoy, ...ORIGINALS];

export function getPiece(id: string): Score | undefined {
  return PIECES.find((p) => p.id === id);
}
