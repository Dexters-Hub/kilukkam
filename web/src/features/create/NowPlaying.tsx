import { useEffect, useRef, useSyncExternalStore } from 'react';
import { onSongStatus, songStatus, type SongPhase } from '../../app/playalong.js';
import { cx } from '../../components/Button.js';
import type { SpotifyTrack } from '../../lib/spotify/api.js';
import { positionAt } from '../../lib/spotify/player.js';
import s from './NowPlaying.module.css';

// The conductor's view of the real recording: artwork, song, where it is,
// and whether it is actually playing (and on the beat). Every play-along
// screen shows it, so "did Spotify start?" is never a guess.

const LABEL: Record<SongPhase, string> = {
  idle: 'Not started',
  connecting: 'Connecting to Spotify…',
  ready: 'Ready on this laptop',
  cued: 'Waiting for the room to start',
  playing: 'Playing',
  paused: 'Paused',
  error: 'Not playing',
};

const clock = (ms: number): string => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export function NowPlaying({ track, compact = false }: { track: SpotifyTrack; compact?: boolean }) {
  const st = useSyncExternalStore(onSongStatus, songStatus);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const mine = st.state?.track?.uri === track.uri ? st.state : null;
  const phase: SongPhase = st.phase === 'playing' && !mine ? 'ready' : st.phase;

  // The progress bar runs on its own frame loop between Spotify's reports.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pos = mine ? positionAt(mine, Date.now()) : 0;
      const dur = mine?.durationMs || track.durationMs;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
      if (timeRef.current) timeRef.current.textContent = `${clock(pos)} / ${clock(dur)}`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mine, track.durationMs]);

  const art = mine?.track?.albumArt ?? track.albumArt;
  const id = track.uri.split(':').pop() ?? track.id;
  return (
    <section className={cx(s.card, compact && s.compact)} aria-label={`Now playing: ${track.name}`}>
      <span className={cx(s.art, phase === 'playing' && s.spinning)}>
        {art ? <img src={art} alt="" width={96} height={96} referrerPolicy="no-referrer" /> : <span className={s.noArt} aria-hidden="true">♪</span>}
      </span>
      <span className={s.body}>
        <span className={s.kicker}>
          <i className={cx(s.dot, s[phase])} aria-hidden="true" />
          <span role="status">{LABEL[phase]}</span>
          {st.message && phase !== 'error' ? <span className={s.note}>· {st.message}</span> : null}
        </span>
        <strong className={s.title}>{track.name}</strong>
        <span className={s.artists}>{track.artists.join(', ')}</span>
        {phase === 'error' && st.message ? (
          <span className={s.error} role="alert">
            {st.message}
          </span>
        ) : (
          <span className={s.progress} aria-hidden="true">
            <span className={s.bar}>
              <span ref={fillRef} className={s.fill} />
            </span>
            <span ref={timeRef} className={s.time} />
          </span>
        )}
        <a className={s.open} href={`https://open.spotify.com/track/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">
          Listen on Spotify
        </a>
      </span>
    </section>
  );
}
