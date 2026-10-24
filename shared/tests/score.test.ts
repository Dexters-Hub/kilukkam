import { describe, it, expect } from 'vitest';
import {
  note, rest, totalBeats, validateScore, offsetTrack,
  type Score, type Track,
} from '../src/score.js';

describe('note/rest builders', () => {
  it('builds a note event', () => {
    expect(note(60, 1)).toEqual({ kind: 'note', midi: 60, beats: 1 });
  });

  it('builds a note with velocity', () => {
    expect(note(64, 0.5, 100)).toEqual({ kind: 'note', midi: 64, beats: 0.5, velocity: 100 });
  });

  it('builds a rest', () => {
    expect(rest(2)).toEqual({ kind: 'rest', beats: 2 });
  });
});

describe('totalBeats', () => {
  it('sums notes and rests', () => {
    expect(totalBeats([note(60, 1), rest(2), note(62, 0.5)])).toBe(3.5);
  });
});

describe('validateScore', () => {
  const good: Score = {
    id: 'x', title: 'X', composer: 'C', bpm: 80, beatsPerBar: 4,
    tracks: [
      { id: 't1', name: 'T1', instrument: 'violin', maxPlayers: 10, events: [note(60, 1)] },
      { id: 't2', name: 'T2', instrument: 'cello', maxPlayers: 10, events: [rest(1)] },
    ],
  };

  it('accepts a valid score', () => {
    expect(validateScore(good)).toEqual([]);
  });

  it('rejects duplicate track ids', () => {
    const bad = { ...good, tracks: [good.tracks[0]!, { ...good.tracks[1]!, id: 't1' }] };
    expect(validateScore(bad)).toContain('duplicate track id: t1');
  });

  it('rejects empty tracks', () => {
    expect(validateScore({ ...good, tracks: [] })).toContain('score has no tracks');
  });

  it('rejects empty events', () => {
    const bad = { ...good, tracks: [{ ...good.tracks[0]!, events: [] }] };
    expect(validateScore(bad)).toContain('track t1 has no events');
  });

  it('rejects out-of-range midi', () => {
    const bad: Track = { ...good.tracks[0]!, events: [note(200, 1)] };
    expect(validateScore({ ...good, tracks: [bad, good.tracks[1]!] }))
      .toContain('track t1 event 0: midi 200 out of range');
  });

  it('rejects non-positive beats', () => {
    const bad: Track = { ...good.tracks[0]!, events: [note(60, 0)] };
    expect(validateScore({ ...good, tracks: [bad, good.tracks[1]!] }))
      .toContain('track t1 event 0: beats must be > 0');
  });

  it('rejects non-positive bpm', () => {
    expect(validateScore({ ...good, bpm: 0 })).toContain('bpm must be > 0');
  });
});

describe('offsetTrack', () => {
  const base: Track = {
    id: 'v1', name: 'Violin I', instrument: 'violin', maxPlayers: 5,
    events: [note(60, 1), note(62, 1), note(64, 1), note(65, 1)],
  };

  it('prepends rests and trims to length', () => {
    const out = offsetTrack(base, 'v2', 'Violin II', 2);
    expect(out.id).toBe('v2');
    expect(out.events).toEqual([
      rest(2), note(60, 1), note(62, 1),
    ]);
  });

  it('zero offset returns equivalent events', () => {
    const out = offsetTrack(base, 'v1x', 'V', 0);
    expect(out.events).toEqual(base.events);
  });
});
