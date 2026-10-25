import { DYNAMICS_GAIN } from '../../app/cues.js';
import { roomBeatNow, store } from '../../app/controller.js';
import { playNote } from '../../lib/audio.js';
import { onsets } from '../../lib/rhythm.js';
import { myTrack } from '../../lib/store.js';

// "Hear the orchestra": in headphones you cannot hear the room, so this phone
// plays the other parts itself, quietly under yours. It does not relay other
// players' taps (those would arrive late and smear); every phone already has
// the score and the shared beat, so the parts are played as written, locked to
// the room's grid. It follows tempo changes, the conductor's pause and rests.

/** How much quieter the band sits under your own part */
const BAND_LEVEL = 0.45;
/** A note this late (in beats) is skipped rather than played out of time */
const LATE_BEATS = 0.25;
const TICK_MS = 12;

const firstFrom = (beats: readonly number[], beat: number): number => {
  const i = beats.findIndex((b) => b >= beat);
  return i < 0 ? beats.length : i;
};

/** Start playing every other part on this phone; returns the stop. */
export function startOrchestra(): () => void {
  const st = store.state;
  const piece = st.piece;
  const mine = myTrack(st)?.id;
  if (!piece) return () => {};
  const start = roomBeatNow() ?? 0;
  const parts = piece.tracks
    .filter((t) => t.id !== mine)
    .map((track) => {
      const at = onsets(track.events);
      return { track, at, next: firstFrom(at, start) };
    });
  let last = start;
  const id = window.setInterval(() => {
    const beat = roomBeatNow();
    if (beat === null) return;
    // The grid went back (a loop or a resync): pick up from where it is now.
    if (beat < last - 0.5) for (const p of parts) p.next = firstFrom(p.at, beat);
    last = beat;
    const snap = store.state.snapshot;
    if (snap?.phase !== 'playing' || snap.paused) return;
    const bpm = snap.tempo?.bpm ?? piece.bpm;
    const level = DYNAMICS_GAIN[snap.dynamics] * BAND_LEVEL;
    for (const p of parts) {
      while (p.next < p.at.length && (p.at[p.next] ?? Infinity) <= beat) {
        const ev = p.track.events[p.next];
        const late = beat - (p.at[p.next] ?? beat);
        p.next++;
        if (ev?.kind !== 'note' || late > LATE_BEATS || snap.mutedTracks.includes(p.track.id)) continue;
        try {
          playNote(p.track.instrument, ev.midi, ev.beats, bpm, ev.velocity ?? 96, { level });
        } catch (err) {
          console.error('orchestra note failed', err);
        }
      }
    }
  }, TICK_MS);
  return () => window.clearInterval(id);
}
