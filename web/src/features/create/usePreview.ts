import type { Score } from '@kilukkam/shared';
import { useEffect, useRef, useState } from 'react';
import { masterBus, preloadInstrument, renderNote, unlockAudio } from '../../lib/audio.js';
import { instrumentsOf } from './pieceMeta.js';

/** How much of a piece the shelf plays: enough to hear its character */
const PREVIEW_SECONDS = 12;
const FADE_SECONDS = 0.4;

/**
 * Hear a piece before choosing it: every part together, the first few
 * seconds, through its own gain so stopping fades out cleanly.
 */
export function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const out = useRef<{ gain: GainNode; timer: number } | null>(null);
  /** Bumped on every play and stop, so a preview still loading its samples is dropped */
  const run = useRef(0);

  const stop = () => {
    run.current++;
    const o = out.current;
    out.current = null;
    setPlaying(null);
    if (!o) return;
    window.clearTimeout(o.timer);
    const c = o.gain.context;
    o.gain.gain.setTargetAtTime(0, c.currentTime, FADE_SECONDS / 3);
    window.setTimeout(() => o.gain.disconnect(), FADE_SECONDS * 1000 + 100);
  };

  const play = async (piece: Score) => {
    stop();
    const c = unlockAudio();
    if (!c) return;
    const mine = ++run.current;
    setPlaying(piece.id);
    await Promise.all(instrumentsOf(piece).map((i) => preloadInstrument(i)));
    if (mine !== run.current) return;
    const gain = c.createGain();
    gain.connect(masterBus(c, 0.7));
    const t0 = c.currentTime + 0.12;
    const spb = 60 / piece.bpm;
    for (const track of piece.tracks) {
      let beat = 0;
      for (const ev of track.events) {
        const at = beat * spb;
        if (at > PREVIEW_SECONDS) break;
        if (ev.kind === 'note') renderNote(c, gain, track.instrument, ev.midi, ev.beats, piece.bpm, t0 + at, ev.velocity, 0.6);
        beat += ev.beats;
      }
    }
    gain.gain.setValueAtTime(1, t0 + PREVIEW_SECONDS - FADE_SECONDS);
    gain.gain.linearRampToValueAtTime(0, t0 + PREVIEW_SECONDS);
    out.current = { gain, timer: window.setTimeout(stop, PREVIEW_SECONDS * 1000 + 200) };
  };

  useEffect(() => stop, []);

  return { playing, play, stop };
}
