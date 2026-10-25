import type { Score } from '@kilukkam/shared';
import { onLive } from '../../app/live.js';
import { Recorder, type Take } from '../../lib/recording.js';

// The conductor's screen keeps a take of the room while the stage is up:
// every note_echo, timed as it arrived. It outlives the stage, so the end
// screen can replay, download and share the performance.

const recorder = new Recorder();
let recordedPiece: Score | null = null;

/** Start a fresh take for this run and keep every echo; returns the stop. */
export function recordTake(piece: Score): () => void {
  recorder.start(piece.id, performance.now());
  recordedPiece = piece;
  return onLive('echo', (e) => recorder.add({ trackId: e.trackId, playerId: e.playerId, noteIndex: e.noteIndex }, performance.now()));
}

/** The latest take with its piece, or null when nobody played. */
export const lastTake = (): { piece: Score; take: Take } | null => {
  const take = recorder.current;
  return take && recordedPiece?.id === take.pieceId ? { piece: recordedPiece, take } : null;
};
