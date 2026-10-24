import type { Grade, PieceResults, PlayerTally, SectionResult } from './protocol.js';

const emptyTally = (): PlayerTally => ({ perfect: 0, great: 0, good: 0, miss: 0, streakBest: 0 });

export const tallyTotal = (t: PlayerTally): number => t.perfect + t.great + t.good + t.miss;

export const tallyAccuracy = (t: PlayerTally): number => {
  const total = tallyTotal(t);
  return total === 0 ? 0 : (t.perfect + t.great + t.good) / total;
};

export const gradeFor = (accuracy: number): Grade =>
  accuracy >= 0.95 ? 'S' : accuracy >= 0.85 ? 'A' : accuracy >= 0.7 ? 'B' : accuracy >= 0.5 ? 'C' : 'D';

/** Fold per-player tallies (keyed by trackId) into section and room results. */
export function aggregateResults(byTrack: ReadonlyMap<string, readonly PlayerTally[]>): PieceResults {
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
  return { sections, room: { notes: tallyTotal(room), accuracy, grade: gradeFor(accuracy) } };
}
