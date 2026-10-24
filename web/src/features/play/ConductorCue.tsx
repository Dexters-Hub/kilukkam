import { useEffect, useRef } from 'react';
import { clock } from '../../app/controller.js';
import { onLive } from '../../app/live.js';
import { useStore } from '../../app/useStore.js';
import { Icon } from '../../components/Icon.js';
import { chipFlash, kilukkamFlash } from '../../lib/anim.js';
import { bell } from '../../lib/audio.js';
import { myTrack } from '../../lib/store.js';
import s from './ConductorCue.module.css';

/**
 * What the conductor is doing to this phone right now, over the play surface:
 * a tempo chip when the room speeds up or slows down, a rest card while this
 * instrument's section rests, a pause card while the room is paused, the
 * count back in when it resumes, and Kilukkam: every phone flashes, sparkles
 * and rings its bell at once. Taps stay silent under the rest and pause cards.
 */
export function ConductorCue() {
  const paused = useStore((st) => st.snapshot?.phase === 'playing' && st.snapshot.paused !== null);
  const restingName = useStore((st) => {
    const t = myTrack(st);
    return st.snapshot?.phase === 'playing' && t && st.snapshot.mutedTracks.includes(t.id) ? t.name : null;
  });
  const roomBpm = useStore((st) => st.snapshot?.paused?.bpm ?? st.snapshot?.tempo?.bpm ?? st.piece?.bpm ?? null);
  const chipRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const lastBpm = useRef<number | null>(roomBpm);
  const flashRef = useRef<HTMLDivElement>(null);
  const sparksRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onLive('kilukkam', () => {
        bell();
        navigator.vibrate?.([30, 40, 30, 40, 30]);
        if (flashRef.current && sparksRef.current) kilukkamFlash(flashRef.current, sparksRef.current, s.spark ?? '');
        if (bellRef.current) chipFlash(bellRef.current, 1);
      }),
    [],
  );

  useEffect(
    () =>
      onLive('tempo', ({ bpm }) => {
        const was = lastBpm.current;
        lastBpm.current = bpm;
        const el = chipRef.current;
        if (!el || was === null || Math.round(bpm) === Math.round(was)) return;
        el.textContent = `${bpm < was ? 'Slower' : 'Faster'} · ${Math.round(bpm)} bpm`;
        chipFlash(el);
      }),
    [],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const off = onLive('resumed', ({ at, bpm }) => {
      const el = countRef.current;
      if (!el) return;
      if (timer) clearInterval(timer);
      const beatMs = 60_000 / bpm;
      const tick = () => {
        const left = at - clock.now();
        if (left <= 0) {
          el.hidden = true;
          if (timer) clearInterval(timer);
          timer = null;
          return;
        }
        el.hidden = false;
        const n = el.querySelector('strong');
        if (n) n.textContent = String(Math.ceil(left / beatMs));
      };
      tick();
      timer = setInterval(tick, 50);
    });
    return () => {
      off();
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <>
      <div ref={flashRef} className={s.flash} aria-hidden="true" />
      <div ref={sparksRef} className={s.sparks} aria-hidden="true" />
      <div ref={bellRef} className={s.bell} role="status" aria-live="polite">
        Kilukkam!
      </div>
      <div ref={chipRef} className={s.chip} role="status" aria-live="polite" />
      <div ref={countRef} className={s.count} role="status" hidden>
        <span>Back in</span>
        <strong />
      </div>
      {paused ? (
        <div className={s.card} role="status">
          <Icon name="hand-tap" size={30} />
          <strong>Paused by the conductor</strong>
          <span>Hold on. The room plays on together.</span>
        </div>
      ) : restingName ? (
        <div className={s.card} role="status">
          <Icon name="speaker-slash" size={30} />
          <strong>{restingName} rests</strong>
          <span>Wait for the conductor to bring you back in.</span>
        </div>
      ) : null}
    </>
  );
}
