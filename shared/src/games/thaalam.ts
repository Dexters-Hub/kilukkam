// Thaalam: note Wordle. Wordle tile semantics plus the pitchd partial
// credit ramp, so a teal tile teaches "you were a fifth away".

export type Tile = 'green' | 'amber' | 'teal' | 'grey';

export const ROW_LEN = 5;

/** pitchd weights, out of 2.5 per slot */
export const TILE_WEIGHTS: Readonly<Record<Tile, number>> = {
  green: 2.5,
  amber: 1.5,
  teal: 1.25,
  grey: 0,
};

const SQUARES: Readonly<Record<Tile, string>> = {
  green: '\u{1F7E9}',
  amber: '\u{1F7E8}',
  teal: '\u{1F7E6}',
  grey: '⬛',
};

/** Octave (0), perfect 4th (5) or perfect 5th (7) apart, by pitch class */
function isHarmonic(a: number, b: number): boolean {
  const pc = (((a - b) % 12) + 12) % 12;
  return pc === 0 || pc === 5 || pc === 7;
}

/**
 * Two-pass Wordle judge. Pass one marks greens; pass two hands out
 * ambers left to right from the answer notes greens did not use, so a
 * guess with three Es against an answer with two never shows three
 * coloured Es. A slot that earns neither is teal when the guess is an
 * octave, 4th or 5th of the answer note in that slot.
 */
export function judgeRow(guess: readonly number[], answer: readonly number[]): Tile[] {
  if (guess.length !== ROW_LEN || answer.length !== ROW_LEN) {
    throw new RangeError(`rows must be ${ROW_LEN} notes`);
  }
  const tiles: Tile[] = new Array<Tile>(ROW_LEN).fill('grey');
  const left = new Map<number, number>();
  for (let i = 0; i < ROW_LEN; i++) {
    if (guess[i] === answer[i]) tiles[i] = 'green';
    else left.set(answer[i]!, (left.get(answer[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < ROW_LEN; i++) {
    if (tiles[i] === 'green') continue;
    const g = guess[i]!;
    const n = left.get(g) ?? 0;
    if (n > 0) {
      tiles[i] = 'amber';
      left.set(g, n - 1);
    } else if (isHarmonic(g, answer[i]!)) {
      tiles[i] = 'teal';
    }
  }
  return tiles;
}

export function scoreRow(tiles: readonly Tile[]): number {
  return tiles.reduce((sum, t) => sum + TILE_WEIGHTS[t], 0);
}

/** Emoji grid for sharing: one line of squares per guess, no notes */
export function shareGrid(rows: readonly (readonly Tile[])[]): string {
  return rows.map((row) => row.map((t) => SQUARES[t]).join('')).join('\n');
}
