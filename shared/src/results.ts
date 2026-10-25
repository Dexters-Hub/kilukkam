import type { Grade, PieceResults, PlayerResult, PlayerTally, SectionResult } from './protocol.js';

const emptyTally = (): PlayerTally => ({ perfect: 0, great: 0, good: 0, miss: 0, streakBest: 0 });

export const tallyTotal = (t: PlayerTally): number => t.perfect + t.great + t.good + t.miss;

export const tallyAccuracy = (t: PlayerTally): number => {
  const total = tallyTotal(t);
  return total === 0 ? 0 : (t.perfect + t.great + t.good) / total;
};

export const gradeFor = (accuracy: number): Grade =>
  accuracy >= 0.95 ? 'S' : accuracy >= 0.85 ? 'A' : accuracy >= 0.7 ? 'B' : accuracy >= 0.5 ? 'C' : 'D';

/**
 * Leaderboard score out of 1000, fair across parts of any length: how well you
 * played your own notes, not how many your part has. Up to 900 for timing
 * (perfect 3, great 2, good 1, miss 0, as a share of the best you could do)
 * and up to 100 for your longest streak as a share of your notes.
 */
export const playerScore = (t: PlayerTally): number => {
  const total = tallyTotal(t);
  if (total === 0) return 0;
  const timing = (t.perfect * 3 + t.great * 2 + t.good) / (total * 3);
  return Math.round(900 * timing + 100 * Math.min(1, t.streakBest / total));
};

/** One reported tally with the server's own record of who sent it */
export interface PlayerEntry {
  playerId: string;
  name: string;
  avatar: string;
  trackId: string;
  tally: PlayerTally;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Best first: score, then accuracy, then best streak, then name (then id, so the order is total). */
export function rankPlayers(entries: readonly PlayerEntry[]): PlayerResult[] {
  return entries
    .map((e) => ({
      playerId: e.playerId,
      name: e.name,
      avatar: e.avatar,
      trackId: e.trackId,
      perfect: e.tally.perfect,
      great: e.tally.great,
      good: e.tally.good,
      miss: e.tally.miss,
      streakBest: e.tally.streakBest,
      accuracy: tallyAccuracy(e.tally),
      score: playerScore(e.tally),
      rank: 0,
    }))
    .sort((a, b) =>
      b.score - a.score ||
      b.accuracy - a.accuracy ||
      b.streakBest - a.streakBest ||
      byName(a.name, b.name) ||
      byName(a.playerId, b.playerId))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/** Fold per-player tallies into section totals, room totals and the ranked leaderboard. */
export function aggregateResults(entries: readonly PlayerEntry[]): PieceResults {
  const byTrack = new Map<string, PlayerTally[]>();
  for (const e of entries) {
    const list = byTrack.get(e.trackId) ?? [];
    list.push(e.tally);
    byTrack.set(e.trackId, list);
  }
  const sections: SectionResult[] = [];
  const room = emptyTally();
  for (const [trackId, tallies] of byTrack) {
    const sum = emptyTally();
    for (const t of tallies) {
      sum.perfect += t.perfect; sum.great += t.great; sum.good += t.good; sum.miss += t.miss;
      sum.streakBest = Math.max(sum.streakBest, t.streakBest);
    }
    room.perfect += sum.perfect; room.great += sum.great; room.good += sum.good; room.miss += sum.miss;
    room.streakBest = Math.max(room.streakBest, sum.streakBest);
    sections.push({ trackId, players: tallies.length, ...sum, accuracy: tallyAccuracy(sum) });
  }
  const accuracy = tallyAccuracy(room);
  return {
    sections,
    room: { notes: tallyTotal(room), accuracy, grade: gradeFor(accuracy) },
    players: rankPlayers(entries),
  };
}
