import { describe, it, expect } from 'vitest';
import { judgeRow, scoreRow, shareGrid, TILE_WEIGHTS, type Tile } from '../../src/games/thaalam.js';

// C4 D4 E4 F4 G4 = 60 62 64 65 67
describe('judgeRow', () => {
  it('all green for an exact match', () => {
    expect(judgeRow([60, 62, 64, 65, 67], [60, 62, 64, 65, 67]))
      .toEqual(['green', 'green', 'green', 'green', 'green']);
  });

  it('amber for a right note in the wrong slot', () => {
    expect(judgeRow([62, 60, 61, 61, 61], [60, 62, 64, 65, 67]))
      .toEqual(['amber', 'amber', 'grey', 'grey', 'grey']);
  });

  it('grey for a note outside the phrase with no harmonic link', () => {
    // C#4 against C4: a semitone is not partial credit
    expect(judgeRow([61, 61, 61, 61, 61], [60, 60, 60, 60, 60]))
      .toEqual(['grey', 'grey', 'grey', 'grey', 'grey']);
  });

  it('answer has two Es, guess has three: greens first, one amber, rest grey', () => {
    // answer E D E C C; guess E E E A A
    const tiles = judgeRow([64, 64, 64, 57, 57], [64, 62, 64, 60, 60]);
    expect(tiles).toEqual(['green', 'grey', 'green', 'grey', 'grey']);
  });

  it('answer has two Es, guess has three Es all misplaced: two amber, one grey', () => {
    // answer E E D C D#; guess D C E E E
    const tiles = judgeRow([62, 60, 64, 64, 64], [64, 64, 62, 60, 63]);
    expect(tiles).toEqual(['amber', 'amber', 'amber', 'amber', 'grey']);
  });

  it('a later green is not stolen by an earlier amber', () => {
    // answer has one E at slot 4; guess has E at slot 0 and slot 4
    const tiles = judgeRow([64, 59, 59, 59, 64], [60, 62, 62, 62, 64]);
    expect(tiles[0]).toBe('grey');
    expect(tiles[4]).toBe('green');
  });

  it('ambers consume answer counts left to right', () => {
    // answer one E (slot 0); guess E at slots 1 and 2
    const tiles = judgeRow([60, 64, 64, 60, 60], [64, 62, 62, 62, 62]);
    expect(tiles.slice(1, 3)).toEqual(['amber', 'grey']);
  });

  it('teal for the octave of the slot answer', () => {
    // C5 against C4 in slot 0
    expect(judgeRow([72, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('teal for an octave below', () => {
    expect(judgeRow([48, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('teal for a perfect fifth above', () => {
    // G4 against C4
    expect(judgeRow([67, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('teal for a perfect fourth above', () => {
    // F4 against C4
    expect(judgeRow([65, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('teal for a fifth below (a fourth by pitch class)', () => {
    // F3 against C4
    expect(judgeRow([53, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('teal for a compound fifth', () => {
    // G5 against C4
    expect(judgeRow([79, 61, 61, 61, 61], [60, 62, 62, 62, 62])[0]).toBe('teal');
  });

  it('no teal for a third or a tritone', () => {
    const tiles = judgeRow([64, 66, 61, 61, 61], [60, 60, 62, 62, 62]);
    expect(tiles.slice(0, 2)).toEqual(['grey', 'grey']);
  });

  it('amber beats teal when the note is elsewhere in the phrase', () => {
    // G4 in slot 0 against C4, and G4 is in slot 1 of the answer (guess slot 1 is not G)
    const tiles = judgeRow([67, 60, 61, 61, 61], [60, 67, 62, 62, 62]);
    expect(tiles.slice(0, 2)).toEqual(['amber', 'amber']);
  });

  it('teal when the amber count is used up', () => {
    // answer has one G (slot 4), already green; G4 in slot 0 against C4 falls back to teal
    const tiles = judgeRow([67, 61, 61, 61, 67], [60, 62, 62, 62, 67]);
    expect(tiles).toEqual(['teal', 'grey', 'grey', 'grey', 'green']);
  });

  it('rejects rows that are not five notes', () => {
    expect(() => judgeRow([60, 62], [60, 62, 64, 65, 67])).toThrow(RangeError);
    expect(() => judgeRow([60, 62, 64, 65, 67], [60, 62, 64, 65, 67, 69])).toThrow(RangeError);
  });

  it('does not mutate its inputs', () => {
    const guess = [64, 64, 64, 57, 57];
    const answer = [64, 62, 64, 60, 60];
    judgeRow(guess, answer);
    expect(guess).toEqual([64, 64, 64, 57, 57]);
    expect(answer).toEqual([64, 62, 64, 60, 60]);
  });
});

describe('scoreRow', () => {
  it('uses the pitchd weights', () => {
    expect(TILE_WEIGHTS).toEqual({ green: 2.5, amber: 1.5, teal: 1.25, grey: 0 });
  });

  it('a solved row scores 12.5', () => {
    expect(scoreRow(['green', 'green', 'green', 'green', 'green'])).toBe(12.5);
  });

  it('sums mixed tiles', () => {
    expect(scoreRow(['green', 'amber', 'teal', 'grey', 'grey'])).toBe(5.25);
  });

  it('an all-grey row scores 0', () => {
    expect(scoreRow(['grey', 'grey', 'grey', 'grey', 'grey'])).toBe(0);
  });
});

describe('shareGrid', () => {
  const rows: Tile[][] = [
    ['grey', 'amber', 'teal', 'grey', 'green'],
    ['green', 'green', 'green', 'green', 'green'],
  ];

  it('one line of five squares per row', () => {
    const lines = shareGrid(rows).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('⬛\u{1F7E8}\u{1F7E6}⬛\u{1F7E9}');
    expect(lines[1]).toBe('\u{1F7E9}'.repeat(5));
  });

  it('carries no spoilers: no digits or note names', () => {
    expect(shareGrid(rows)).not.toMatch(/[0-9A-G]/);
  });

  it('empty input gives an empty grid', () => {
    expect(shareGrid([])).toBe('');
  });
});
