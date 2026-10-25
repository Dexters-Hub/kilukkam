import type { Score } from '@kilukkam/shared';
import { roomTimeOf } from '../../app/controller.js';
import { onLive } from '../../app/live.js';
import { onsets } from '../../lib/rhythm.js';
import { Recorder, type Take } from '../../lib/recording.js';

// The conductor's screen keeps a take of the room while the stage is up:
// every note a phone played. It outlives the stage, so the end screen can
// replay, download and share the performance.
//
// Each note is timed by its place on the room's beat grid, not by when its
// echo arrived, so network jitter never smears the replay. Tempo changes the
// conductor made are kept, because the grid carries them.

const recorder = new Recorder();
let recordedPiece: Score | null = null;

/** Start a fresh take for this run and keep every echo; returns the stop. */
export function recordTake(piece: Score): () => void {
  const opened = performance.now();
  // Times are ms since the run's first beat; the recorder's origin is 0.
  recorder.start(piece.id, 0);
  recordedPiece = piece;
  const beats = new Map(piece.tracks.map((t) => [t.id, onsets(t.events)]));
  // Thirty phones on one part play each note thirty times: keep it once.
  const kept = new Map<string, number>();
  return onLive('echo', (e) => {
    const beat = beats.get(e.trackId)?.[e.noteIndex];
    const slot = beat === undefined ? null : roomTimeOf(beat);
    const zero = roomTimeOf(0);
    const ms = slot !== null && zero !== null ? slot - zero : performance.now() - opened;
    const key = `${e.trackId}:${e.noteIndex}`;
    const prev = kept.get(key);
    if (prev !== undefined && Math.abs(prev - ms) < 60) return;
    kept.set(key, ms);
    recorder.add({ trackId: e.trackId, playerId: e.playerId, noteIndex: e.noteIndex }, ms);
  });
}

/** The latest take with its piece, or null when nobody played. */
export const lastTake = (): { piece: Score; take: Take } | null => {
  const take = recorder.current;
  return take && recordedPiece?.id === take.pieceId ? { piece: recordedPiece, take } : null;
};
