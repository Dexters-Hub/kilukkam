import { describe, it, expect } from 'vitest';
import {
  PHRASES, DAILY_POOL, GENRES, getPhrase, phrasesByGenre, validatePhrase,
  PHRASE_LEN, MIN_PHRASE_MIDI, MAX_PHRASE_MIDI, type Phrase,
} from '../../src/games/phrases.js';

describe('phrase bank', () => {
  it('has 40 phrases', () => {
    expect(PHRASES).toHaveLength(40);
  });

  it('every phrase validates', () => {
    for (const p of PHRASES) {
      expect(validatePhrase(p), `phrase ${p.id}`).toEqual([]);
    }
  });

  it('every midi array is five ints in range', () => {
    for (const p of PHRASES) {
      expect(p.midi, p.id).toHaveLength(PHRASE_LEN);
      for (const m of p.midi) {
        expect(Number.isInteger(m), p.id).toBe(true);
        expect(m, p.id).toBeGreaterThanOrEqual(MIN_PHRASE_MIDI);
        expect(m, p.id).toBeLessThanOrEqual(MAX_PHRASE_MIDI);
      }
    }
  });

  it('ids are unique', () => {
    const ids = PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no two phrases share the same five notes', () => {
    const keys = PHRASES.map((p) => p.midi.join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spreads across every genre', () => {
    const by = phrasesByGenre();
    expect(by.classical.length).toBeGreaterThanOrEqual(10);
    expect(by.film.length + by.rahman.length).toBeGreaterThanOrEqual(8);
    expect(by.rahman.length).toBeGreaterThanOrEqual(3);
    expect(by.folk.length).toBeGreaterThanOrEqual(6);
    expect(by.pop.length).toBeGreaterThanOrEqual(8);
  });

  it('phrasesByGenre covers the whole bank exactly once', () => {
    const by = phrasesByGenre();
    expect(Object.keys(by).sort()).toEqual([...GENRES].sort());
    const total = GENRES.reduce((n, g) => n + by[g].length, 0);
    expect(total).toBe(PHRASES.length);
  });

  it('getPhrase finds by id and rejects unknown', () => {
    expect(getPhrase(PHRASES[0]!.id)).toBe(PHRASES[0]);
    expect(getPhrase('nope')).toBeUndefined();
  });

  it('DAILY_POOL holds only verified phrases', () => {
    expect(DAILY_POOL.length).toBeGreaterThanOrEqual(25);
    expect(DAILY_POOL.every((p) => !p.unverified)).toBe(true);
    expect(DAILY_POOL.length + PHRASES.filter((p) => p.unverified).length).toBe(PHRASES.length);
  });

  it('opens Ode to Joy on F#4 F#4 G4 A4 A4', () => {
    expect(getPhrase('ode-to-joy')?.midi).toEqual([66, 66, 67, 69, 69]);
  });
});

describe('validatePhrase', () => {
  const good: Phrase = {
    id: 'test', song: 'Test', composer: 'Someone', genre: 'folk',
    key: 'C major', era: 'Traditional', midi: [60, 62, 64, 65, 67],
  };

  it('accepts a valid phrase', () => {
    expect(validatePhrase(good)).toEqual([]);
  });

  it('accepts an artist in place of a composer', () => {
    const { composer: _, ...rest } = good;
    expect(validatePhrase({ ...rest, artist: 'A Band' })).toEqual([]);
  });

  it('requires a composer or an artist', () => {
    const { composer: _, ...rest } = good;
    expect(validatePhrase(rest)).toContain('phrase test: needs a composer or an artist');
  });

  it('rejects the wrong number of notes', () => {
    expect(validatePhrase({ ...good, midi: [60, 62, 64] }))
      .toContain('phrase test: needs 5 notes, has 3');
  });

  it('rejects notes out of range', () => {
    expect(validatePhrase({ ...good, midi: [60, 62, 64, 65, 90] }))
      .toContain('phrase test note 4: midi 90 out of range');
    expect(validatePhrase({ ...good, midi: [60.5, 62, 64, 65, 67] }))
      .toContain('phrase test note 0: midi 60.5 out of range');
  });

  it('rejects a phrase of one repeated pitch (no puzzle)', () => {
    expect(validatePhrase({ ...good, midi: [60, 60, 60, 60, 60] }))
      .toContain('phrase test: needs at least two distinct notes');
  });

  it('rejects an unknown genre', () => {
    expect(validatePhrase({ ...good, genre: 'jazz' as Phrase['genre'] }))
      .toContain('phrase test: unknown genre jazz');
  });
});
