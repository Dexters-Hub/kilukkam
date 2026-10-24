import type { DjCue, DynamicsLevel } from '@kilukkam/shared';

// Frames that drive live visuals (ripples, room dots, cues). They skip the
// store and React entirely: screens subscribe from an effect and animate refs.

export interface NoteEcho {
  playerId: string;
  trackId: string;
  noteIndex: number;
}

/** Taps per track since the last pulse (~4 Hz), from ensemble_pulse */
export interface EnsemblePulse {
  counts: Record<string, number>;
  total: number;
}

export interface DjEvent {
  cue: DjCue;
  /** Server ms the cue was given */
  at: number;
  /** Server ms the effect wears off (drop and build); null for loops */
  until: number | null;
}

export interface LiveEvents {
  echo: NoteEcho;
  pulse: EnsemblePulse;
  dj: DjEvent;
  tempo: { bpm: number };
  /** The conductor paused the room on `beat` (server ms `at`) */
  paused: { at: number; beat: number };
  /** The room plays again from server ms `at` at `bpm`, after a count-in */
  resumed: { at: number; bpm: number };
  /** The conductor rang the room-wide bell at server ms `at` */
  kilukkam: { at: number };
  dynamics: DynamicsLevel;
  rtt: number;
}

type Handler<K extends keyof LiveEvents> = (e: LiveEvents[K]) => void;

const handlers: { [K in keyof LiveEvents]: Set<Handler<K>> } = {
  echo: new Set(),
  pulse: new Set(),
  dj: new Set(),
  tempo: new Set(),
  paused: new Set(),
  resumed: new Set(),
  kilukkam: new Set(),
  dynamics: new Set(),
  rtt: new Set(),
};

export const onLive = <K extends keyof LiveEvents>(kind: K, fn: Handler<K>): (() => void) => {
  handlers[kind].add(fn);
  return () => {
    handlers[kind].delete(fn);
  };
};

export const emitLive = <K extends keyof LiveEvents>(kind: K, e: LiveEvents[K]): void => {
  for (const fn of handlers[kind]) fn(e);
};
