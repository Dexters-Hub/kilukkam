import type { ClientMessage, Score } from '@kilukkam/shared';
import type { ConductorCue, CueSide } from '../../lib/camera/conductor.js';

// What each camera gesture asks of the room, as plain protocol messages, so
// the mapping is testable without a camera or a socket. No gesture ever
// produces stop_piece: ending the piece is the Stop button's job alone.

export const SIDES: readonly CueSide[] = ['left', 'center', 'right'];

export type Sections = Record<CueSide, { ids: string[]; label: string }>;

/** Split the instruments into thirds of the picture, left to right in score order. */
export const sectionsFor = (piece: Score): Sections => {
  const n = piece.tracks.length;
  const out: Sections = { left: { ids: [], label: '' }, center: { ids: [], label: '' }, right: { ids: [], label: '' } };
  piece.tracks.forEach((t, i) => {
    const side = SIDES[Math.min(2, Math.floor((i * 3) / Math.max(1, n)))] ?? 'right';
    out[side].ids.push(t.id);
    out[side].label = out[side].label ? `${out[side].label} + ${t.name}` : t.name;
  });
  return out;
};

export interface GestureRoom {
  sections: Sections;
  /** A Spotify recording cannot follow tempo changes: the room stays locked to it */
  playAlong: boolean;
  paused: boolean;
  looping: boolean;
}

export function messagesFor(cue: ConductorCue, room: GestureRoom): ClientMessage[] {
  switch (cue.kind) {
    case 'beat':
      return [];
    case 'tempo':
      return room.playAlong ? [] : [{ type: 'set_tempo', bpm: cue.bpm }];
    case 'dynamics':
      return [{ type: 'set_dynamics', level: cue.level }];
    case 'cue':
      return room.sections[cue.side].ids.map((trackId) => ({ type: 'set_section', trackId, muted: false }));
    case 'rest':
      return room.sections[cue.side].ids.map((trackId) => ({ type: 'set_section', trackId, muted: true }));
    case 'pause':
      return room.paused ? [] : [{ type: 'pause_piece' }];
    case 'resume':
      return room.paused ? [{ type: 'resume_piece' }] : [];
    case 'build':
      return room.paused ? [] : [{ type: 'dj', cue: 'build' }];
    case 'drop':
      return room.paused ? [] : [{ type: 'dj', cue: 'drop' }];
    case 'loop':
      return room.paused ? [] : [{ type: 'dj', cue: room.looping ? 'loop_off' : 'loop_on' }];
    case 'kilukkam':
      return room.paused ? [] : [{ type: 'kilukkam' }];
  }
}
