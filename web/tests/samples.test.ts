import { describe, expect, it } from 'vitest';
import { getPiece, PIECES } from '@kilukkam/shared';
import { BANKS_FOR, BANK_NOTES, loopRegion, nearestSample, pickBank, rateFor, sampleUrl, shapeFor } from '../src/lib/samples.js';

describe('nearestSample', () => {
  const notes = [55, 60, 64];
  it('picks the closest recording', () => {
    expect(nearestSample(notes, 61)).toBe(60);
    expect(nearestSample(notes, 63)).toBe(64);
    expect(nearestSample(notes, 40)).toBe(55);
    expect(nearestSample(notes, 90)).toBe(64);
  });
  it('breaks ties toward the lower recording', () => {
    expect(nearestSample(notes, 62)).toBe(60);
  });
  it('is undefined without recordings', () => {
    expect(nearestSample([], 60)).toBeUndefined();
  });
});

describe('rateFor', () => {
  it('shifts by equal-tempered semitones', () => {
    expect(rateFor(60, 72)).toBe(2);
    expect(rateFor(60, 48)).toBe(0.5);
    expect(rateFor(60, 61)).toBeCloseTo(1.0595, 4);
  });
});

describe('coverage', () => {
  it('every note in every bundled piece is within 3 semitones of a recording', () => {
    for (const piece of PIECES) {
      for (const track of piece.tracks) {
        for (const e of track.events) {
          if (e.kind !== 'note') continue;
          const near = nearestSample(BANK_NOTES[track.instrument], e.midi);
          expect(near, `${piece.id}/${track.id} midi ${e.midi}`).toBeDefined();
          expect(Math.abs((near ?? 0) - e.midi), `${piece.id}/${track.id} midi ${e.midi}`).toBeLessThanOrEqual(3);
        }
      }
    }
    expect(getPiece('canon-in-d')).toBeDefined();
  });
});

describe('loopRegion / sampleUrl', () => {
  it('loops the steady middle of a long recording', () => {
    expect(loopRegion(5)).toEqual({ start: 1.2, end: 4.55 });
    expect(loopRegion(0.8)).toBeNull();
  });
  it('points at the bundled files', () => {
    expect(sampleUrl('violin', 72)).toBe('/samples/violin/72.m4a');
    expect(sampleUrl('cello-short', 48)).toBe('/samples/cello-short/48.m4a');
  });
});

describe('pickBank', () => {
  const all = () => true;
  it('gives quick notes a short stroke and long notes the sustained take', () => {
    expect(pickBank('violin', 0.2, 96, false, all)).toBe('violin-short');
    expect(pickBank('violin', 1.2, 96, false, all)).toBe('violin');
  });
  it('never uses a short stroke for a held note', () => {
    expect(pickBank('cello', 0.2, 96, true, all)).toBe('cello');
  });
  it('uses the soft take for gentle notes, where one exists', () => {
    expect(pickBank('violin', 1, 40, false, all)).toBe('violin-soft');
    expect(pickBank('flute', 1, 40, false, all)).toBe('flute');
  });
  it('falls back to the main bank until the extra articulations load', () => {
    expect(pickBank('violin', 0.2, 40, false, (b) => b === 'violin')).toBe('violin');
  });
  it('piano always plays its single bank', () => {
    expect(pickBank('piano', 0.1, 20, false, all)).toBe('piano');
  });
  it('short strokes ring off fast and never loop', () => {
    expect(shapeFor('violin-short', 'violin')).toMatchObject({ release: 0.12, loops: false });
    expect(shapeFor('violin', 'violin').loops).toBe(true);
  });
  it('every bank listed for an instrument has recordings', () => {
    for (const banks of Object.values(BANKS_FOR)) for (const b of banks) expect(BANK_NOTES[b].length).toBeGreaterThan(5);
  });
});
