import { describe, expect, it } from 'vitest';
import { aggregateResults, playerScore, rankPlayers, type PlayerEntry } from '../src/results.js';
import { MAX_NAME_LEN, MAX_PLAYERS, parseServerMessage, type PieceResults, type PlayerTally } from '../src/protocol.js';

const t = (perfect: number, great = 0, good = 0, miss = 0, streakBest = 0): PlayerTally => ({ perfect, great, good, miss, streakBest });
const entry = (name: string, tally: PlayerTally, trackId = 'flute'): PlayerEntry => ({ playerId: `id-${name}`, name, avatar: 'bach', trackId, tally });

describe('playerScore', () => {
  it('scores out of 1000: 900 for timing as a share of your notes, 100 for the streak', () => {
    expect(playerScore(t(0))).toBe(0);
    expect(playerScore(t(1, 1, 1, 5))).toBe(225);
    expect(playerScore(t(10, 0, 0, 0, 9))).toBe(990);
    expect(playerScore(t(10, 0, 0, 0, 10))).toBe(1000);
    expect(playerScore(t(25, 0, 0, 0, 25))).toBe(1000);
  });

  it('is fair across part lengths: a flawless short part beats a sloppy long one', () => {
    expect(playerScore(t(8, 0, 0, 0, 8))).toBeGreaterThan(playerScore(t(30, 0, 0, 30, 10)));
  });
});

describe('rankPlayers', () => {
  it('orders by score and numbers ranks from 1', () => {
    const out = rankPlayers([entry('Low', t(1, 0, 0, 9, 1)), entry('High', t(9, 0, 0, 1, 9)), entry('Mid', t(5, 0, 0, 5, 5))]);
    expect(out.map((p) => [p.name, p.rank, p.score])).toEqual([['High', 1, 900], ['Mid', 2, 500], ['Low', 3, 100]]);
  });

  it('breaks a score tie by accuracy, then best streak, then name', () => {
    // Same score 300: four goods with no misses beats two perfects among misses.
    const acc = rankPlayers([entry('Spotty', t(2, 0, 0, 4)), entry('Goods', t(0, 0, 4, 0))]);
    expect(acc.map((p) => p.score)).toEqual([300, 300]);
    expect(acc.map((p) => p.name)).toEqual(['Goods', 'Spotty']);

    const streak = rankPlayers([entry('Short', t(4, 0, 0, 1, 2)), entry('Long', t(4, 0, 0, 1, 4))]);
    expect(streak.map((p) => p.name)).toEqual(['Long', 'Short']);

    const name = rankPlayers([entry('Zed', t(3)), entry('Amy', t(3))]);
    expect(name.map((p) => [p.name, p.rank])).toEqual([['Amy', 1], ['Zed', 2]]);
  });

  it('reports accuracy 0..1 and 0 for an empty tally', () => {
    const [a, b] = rankPlayers([entry('A', t(3, 0, 0, 1)), entry('B', t(0))]);
    expect(a!.accuracy).toBeCloseTo(0.75);
    expect(b!.accuracy).toBe(0);
  });
});

describe('aggregateResults', () => {
  it('keeps sections and room totals alongside the leaderboard', () => {
    const res = aggregateResults([entry('A', t(8, 0, 0, 2, 8)), entry('B', t(10, 0, 0, 0, 10)), entry('C', t(5, 0, 0, 5, 5), 'cello')]);
    expect(res.sections.find((s) => s.trackId === 'flute')).toMatchObject({ players: 2, perfect: 18, miss: 2, streakBest: 10 });
    expect(res.room.notes).toBe(30);
    expect(res.players.map((p) => p.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('piece_results parser', () => {
  const good = (): PieceResults => aggregateResults([entry('A', t(8, 1, 1, 0, 10)), entry('B', t(2, 0, 0, 8, 1), 'cello')]);
  const parse = (results: unknown) => parseServerMessage(JSON.stringify({ type: 'piece_results', results }));
  const withPlayer = (patch: Record<string, unknown>) => {
    const r = good();
    return { ...r, players: [{ ...r.players[0], ...patch }, r.players[1]] };
  };

  it('accepts a well-formed result', () => {
    expect(parse(good())).toEqual({ type: 'piece_results', results: good() });
  });

  it('rejects a result without players', () => {
    const { players: _drop, ...rest } = good();
    expect(parse(rest)).toBeNull();
    expect(parse({ ...good(), players: 'nope' })).toBeNull();
  });

  it('caps the leaderboard at MAX_PLAYERS entries', () => {
    const many = aggregateResults(Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => entry(`P${i}`, t(i % 20))));
    expect(parse(many)).toBeNull();
    const full = aggregateResults(Array.from({ length: MAX_PLAYERS }, (_, i) => entry(`P${i}`, t(i % 20))));
    expect(parse(full)).not.toBeNull();
  });

  it('caps string lengths', () => {
    expect(parse(withPlayer({ name: 'x'.repeat(MAX_NAME_LEN + 1) }))).toBeNull();
    expect(parse(withPlayer({ name: '' }))).toBeNull();
    expect(parse(withPlayer({ avatar: 'a'.repeat(25) }))).toBeNull();
    expect(parse(withPlayer({ playerId: 'i'.repeat(65) }))).toBeNull();
    expect(parse(withPlayer({ trackId: 7 }))).toBeNull();
  });

  it('bounds the numbers', () => {
    expect(parse(withPlayer({ accuracy: 1.5 }))).toBeNull();
    expect(parse(withPlayer({ accuracy: -0.1 }))).toBeNull();
    expect(parse(withPlayer({ accuracy: Number.NaN }))).toBeNull();
    expect(parse(withPlayer({ score: -1 }))).toBeNull();
    expect(parse(withPlayer({ score: 2.5 }))).toBeNull();
    expect(parse(withPlayer({ score: 1e9 }))).toBeNull();
    expect(parse(withPlayer({ perfect: -3 }))).toBeNull();
    expect(parse(withPlayer({ miss: 100_001 }))).toBeNull();
    expect(parse(withPlayer({ streakBest: '9' }))).toBeNull();
  });

  it('requires ranks 1..n in list order', () => {
    expect(parse(withPlayer({ rank: 2 }))).toBeNull();
    expect(parse(withPlayer({ rank: 0 }))).toBeNull();
    const r = good();
    expect(parse({ ...r, players: [r.players[1], r.players[0]] })).toBeNull();
  });

  it('rejects a player entry that is not an object', () => {
    expect(parse({ ...good(), players: [null] })).toBeNull();
    expect(parse({ ...good(), players: [['A']] })).toBeNull();
  });
});
