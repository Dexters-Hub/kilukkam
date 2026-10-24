import type { Score } from '../../score.js';
import { bossRush, bossRushHarmony } from './boss-rush.js';
import { hallowedDepths, hallowedDepthsHarmony } from './hallowed-depths.js';
import { pixelPlains, pixelPlainsDrums, pixelPlainsHarmony } from './pixel-plains.js';

// Kilukkam's own pieces, composed for a room of phones. Every note here is
// original; see INTEGRATION.md for how they join the piece library.

export { bossRush, hallowedDepths, pixelPlains, pixelPlainsDrums };

export const ORIGINALS: readonly Score[] = [hallowedDepths, bossRush, pixelPlains];

/** Each piece's harmony plan, one entry per bar, keyed by piece id: what the tests hold the parts to. */
export const HARMONY: Readonly<Record<string, readonly string[]>> = {
  [hallowedDepths.id]: hallowedDepthsHarmony,
  [bossRush.id]: bossRushHarmony,
  [pixelPlains.id]: pixelPlainsHarmony,
};
