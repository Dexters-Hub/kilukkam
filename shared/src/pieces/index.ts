import { canonInD } from './canon-in-d.js';
import { furElise } from './fur-elise.js';
import { greensleeves } from './greensleeves.js';
import { mountainKing } from './mountain-king.js';
import { odeToJoy } from './ode-to-joy.js';
import { ORIGINALS, bossRush, hallowedDepths, pixelPlains } from './originals/index.js';
import { spanishRomance } from './spanish-romance.js';
import type { Score } from '../score.js';

export { canonInD, odeToJoy, hallowedDepths, bossRush, pixelPlains, ORIGINALS, spanishRomance, greensleeves, mountainKing, furElise };

export const PIECES: readonly Score[] = [canonInD, odeToJoy, ...ORIGINALS, spanishRomance, greensleeves, mountainKing, furElise];

export function getPiece(id: string): Score | undefined {
  return PIECES.find((p) => p.id === id);
}
