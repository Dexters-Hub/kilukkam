import type { InstrumentId, Score } from '@kilukkam/shared';

// What the music shelf shows about a piece: how long it runs, how it feels,
// how hard it is, and which instrument colours its cover is painted in.

/** Longest part, in seconds, at the written tempo */
export const durationOf = (piece: Score): number => {
  const beats = Math.max(0, ...piece.tracks.map((t) => t.events.reduce((sum, e) => sum + e.beats, 0)));
  return Math.round((beats * 60) / piece.bpm);
};

export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const MOOD: Record<string, string> = {
  'canon-in-d': 'Warm and flowing',
  'ode-to-joy': 'Bright anthem',
  'hallowed-depths': 'Calm, cave echoes',
  'boss-rush': 'Fast and fierce',
  'pixel-plains': 'Bouncy 8-bit',
  'spanish-romance': 'Tender, fingerstyle',
  greensleeves: 'Old English folk',
  'mountain-king': 'Sneaky, then wild',
  'fur-elise': 'Delicate classic',
};

export const moodOf = (piece: Score): string => MOOD[piece.id] ?? piece.composer;

export const levelOf = (piece: Score): 'Easy' | 'Medium' | 'Hard' => (piece.bpm < 90 ? 'Easy' : piece.bpm < 135 ? 'Medium' : 'Hard');

/** The piece's instruments in score order, each once */
export const instrumentsOf = (piece: Score): InstrumentId[] => [...new Set(piece.tracks.map((t) => t.instrument))];

/** Seats across all parts */
export const seatsOf = (piece: Score): number => piece.tracks.reduce((n, t) => n + t.maxPlayers, 0);
