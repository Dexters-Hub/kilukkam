import type { Score } from '@kilukkam/shared';
import { useEffect } from 'react';
import { store } from '../../app/controller.js';
import { DYNAMICS_GAIN } from '../../app/cues.js';
import { onLive } from '../../app/live.js';
import { playNote } from '../../lib/audio.js';

// The conductor's screen plays the room: every note a phone plays comes back
// as a note_echo, and this sounds it here, so a conductor with headphones (or
// a laptop on the projector) hears the whole performance, mistakes and all.
//
// Thirty phones on one part send thirty echoes of the same note. Each note
// sounds once per part within a short window, so a full room stays clear
// instead of turning to mush.

/** Echoes of one note within this window count as one */
const MERGE_MS = 140;
/** Keeps the laptop's audio from choking on a burst */
const MAX_PER_SECOND = 40;

export function useRoomSound(piece: Score | null, on: boolean): void {
  useEffect(() => {
    if (!on || !piece) return;
    const recent = new Map<string, number>();
    let windowStart = 0;
    let inWindow = 0;
    return onLive('echo', (e) => {
      const now = performance.now();
      const key = `${e.trackId}:${e.noteIndex}`;
      const last = recent.get(key);
      if (last !== undefined && now - last < MERGE_MS) return;
      recent.set(key, now);
      if (recent.size > 512) recent.clear();
      if (now - windowStart > 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (++inWindow > MAX_PER_SECOND) return;
      const track = piece.tracks.find((t) => t.id === e.trackId);
      const ev = track?.events[e.noteIndex];
      if (!track || ev?.kind !== 'note') return;
      const st = store.state;
      const bpm = st.snapshot?.tempo?.bpm ?? piece.bpm;
      const level = DYNAMICS_GAIN[st.snapshot?.dynamics ?? 'mf'];
      try {
        playNote(track.instrument, ev.midi, ev.beats, bpm, ev.velocity ?? 96, { level });
      } catch (err) {
        console.error('room sound failed', err);
      }
    });
  }, [piece, on]);
}
