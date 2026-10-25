import type { Score } from '@kilukkam/shared';
import { useEffect } from 'react';
import { roomTimeOf, serverNow, store } from '../../app/controller.js';
import { DYNAMICS_GAIN } from '../../app/cues.js';
import { onLive } from '../../app/live.js';
import { playNote, preloadInstrument } from '../../lib/audio.js';
import { onsets } from '../../lib/rhythm.js';

// The conductor's screen plays the room: every note a phone plays comes back
// as a note_echo, and this sounds it here, so a conductor with headphones (or
// a laptop on the projector) hears the whole performance.
//
// Echoes arrive with network jitter, so playing them on arrival smears the
// music. Instead each played note sounds on its own place in the room's beat
// grid, a fixed moment later (PLAYOUT_MS), like a jitter buffer: notes nobody
// played stay silent, but the ones the room played land evenly in time.
// Thirty phones on one part send thirty echoes of a note; it sounds once.

/** How far behind the room the stage plays, so late echoes still land on time */
const PLAYOUT_MS = 180;
/** An echo later than this behind its slot plays on arrival instead */
const TOO_LATE_MS = 160;
/** The longest an early tap waits for its slot */
const MAX_WAIT_MS = PLAYOUT_MS + 220;
/** Echoes of one note within this window are the same note from several phones */
const MERGE_MS = 400;
/** Room sound sits under the phones in the room rather than over them */
const ROOM_LEVEL = 0.6;

export function useRoomSound(piece: Score | null, on: boolean): void {
  useEffect(() => {
    if (!on || !piece) return;
    // Real recordings, not the backup synth: load every instrument the piece uses.
    for (const t of piece.tracks) void preloadInstrument(t.instrument);
    const beats = new Map(piece.tracks.map((t) => [t.id, onsets(t.events)]));
    const recent = new Map<string, number>();
    return onLive('echo', (e) => {
      const at = performance.now();
      const key = `${e.trackId}:${e.noteIndex}`;
      const last = recent.get(key);
      if (last !== undefined && at - last < MERGE_MS) return;
      recent.set(key, at);
      const track = piece.tracks.find((t) => t.id === e.trackId);
      const ev = track?.events[e.noteIndex];
      if (!track || ev?.kind !== 'note') return;
      const snap = store.state.snapshot;
      if (snap?.paused) return;
      // Where this note belongs on the room's grid, and how long until that moment plus the buffer.
      const beat = beats.get(e.trackId)?.[e.noteIndex];
      const slot = beat === undefined ? null : roomTimeOf(beat);
      const now = serverNow();
      let delay = 0;
      // Far behind its slot (a looped bar replays old slots, or a stalled
      // connection): sound it now rather than lose it. Far ahead (someone
      // tapped well before the beat): no more than MAX_WAIT_MS behind the tap.
      if (slot !== null && now !== null) {
        const wait = slot + PLAYOUT_MS - now;
        delay = wait < -TOO_LATE_MS ? 0 : Math.min(MAX_WAIT_MS, Math.max(0, wait)) / 1000;
      }
      const bpm = snap?.tempo?.bpm ?? piece.bpm;
      const level = DYNAMICS_GAIN[snap?.dynamics ?? 'mf'] * ROOM_LEVEL;
      try {
        playNote(track.instrument, ev.midi, ev.beats, bpm, ev.velocity ?? 96, { level, delay });
      } catch (err) {
        console.error('room sound failed', err);
      }
    });
  }, [piece, on]);
}
