import { describe, it, expect } from 'vitest';
import { PIECES, getPiece } from '../src/pieces/index.js';
import { validateScore, totalBeats } from '../src/score.js';

describe('piece library', () => {
  it('has at least two pieces', () => {
    expect(PIECES.length).toBeGreaterThanOrEqual(2);
  });

  it('every piece validates', () => {
    for (const p of PIECES) {
      expect(validateScore(p), `piece ${p.id}`).toEqual([]);
    }
  });

  it('ids are unique', () => {
    const ids = PIECES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getPiece finds by id and rejects unknown', () => {
    expect(getPiece(PIECES[0]!.id)).toBe(PIECES[0]);
    expect(getPiece('nope')).toBeUndefined();
  });
});

describe('canon-in-d', () => {
  const canon = getPiece('canon-in-d')!;

  it('exists with 4 tracks', () => {
    expect(canon).toBeDefined();
    expect(canon.tracks.map((t) => t.id)).toEqual(['violin-1', 'violin-2', 'violin-3', 'cello']);
  });

  it('violin tracks are equal length (canon stagger)', () => {
    const lens = canon.tracks.slice(0, 3).map((t) => totalBeats(t.events));
    expect(lens[0]).toBe(lens[1]);
    expect(lens[1]).toBe(lens[2]);
  });

  it('violin-2 starts with a 2-bar rest', () => {
    const v2 = canon.tracks[1]!;
    expect(v2.events[0]).toEqual({ kind: 'rest', beats: canon.beatsPerBar * 2 });
  });

  it('cello covers the full piece', () => {
    const v1Beats = totalBeats(canon.tracks[0]!.events);
    const celloBeats = totalBeats(canon.tracks[3]!.events);
    expect(celloBeats).toBe(v1Beats);
  });

  it('opens on F#5 (the famous first note)', () => {
    const first = canon.tracks[0]!.events[0]!;
    expect(first).toMatchObject({ kind: 'note', midi: 78 });
  });
});

describe('ode-to-joy', () => {
  const ode = getPiece('ode-to-joy')!;

  it('exists with multiple tracks', () => {
    expect(ode).toBeDefined();
    expect(ode.tracks.length).toBeGreaterThanOrEqual(2);
  });

  it('all tracks are the same length', () => {
    const lens = ode.tracks.map((t) => totalBeats(t.events));
    expect(new Set(lens).size).toBe(1);
  });
});
