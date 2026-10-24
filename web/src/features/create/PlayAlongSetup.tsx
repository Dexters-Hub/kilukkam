import { useEffect, useRef, useState } from 'react';
import { actions } from '../../app/controller.js';
import { currentPlayer, ensurePlayer, stopSong } from '../../app/playalong.js';
import { useStore } from '../../app/useStore.js';
import { Button } from '../../components/Button.js';
import type { SpotifyTrack } from '../../lib/spotify/api.js';
import type { Key, Mode } from '../../lib/spotify/playalong.js';
import { type PlaybackState, positionAt } from '../../lib/spotify/player.js';
import { type SongBeat, songBeatFromTaps } from '../../lib/spotify/sync.js';
import { NowPlaying } from './NowPlaying.js';
import s from './SpotifyCard.module.css';

// Listen and tap the beat: the song plays on this laptop and the conductor
// taps along. Each tap is stamped with the song position from the latest
// player state, so the fit is a beat grid inside the song, not on the clock.

const TONICS = ['C', 'C sharp', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat', 'A', 'B flat', 'B'] as const;
const KEYS: { value: string; label: string; key: Key }[] = (['major', 'minor'] as const satisfies readonly Mode[]).flatMap((mode) =>
  TONICS.map((name, tonic) => ({ value: `${tonic}-${mode}`, label: `${name} ${mode}`, key: { tonic, mode } })),
);

const steadiness = (c: number): string => (c >= 0.8 ? 'steady' : c >= 0.5 ? 'a little loose' : 'loose, keep tapping');

type Conn = { kind: 'idle' } | { kind: 'connecting' } | { kind: 'playing' } | { kind: 'paused' } | { kind: 'error'; message: string };

export function PlayAlongSetup({ track, onBack }: { track: SpotifyTrack; onBack: () => void }) {
  const [conn, setConn] = useState<Conn>({ kind: 'idle' });
  const [taps, setTaps] = useState<number[]>([]);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [keyValue, setKeyValue] = useState('');
  const latest = useRef<PlaybackState | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const opening = useStore((st) => st.intent?.kind === 'create');

  useEffect(
    () => () => {
      unsubscribe.current?.();
    },
    [],
  );

  const beat: SongBeat | null = songBeatFromTaps(taps);

  const play = async () => {
    // Unlock audio inside the tap, before anything is awaited (iOS and Safari need this).
    void currentPlayer()?.activate();
    setConn({ kind: 'connecting' });
    const r = await ensurePlayer();
    if (!r.ok) {
      setConn({ kind: 'error', message: r.message });
      return;
    }
    const p = r.player;
    unsubscribe.current?.();
    unsubscribe.current = p.onState((st) => {
      latest.current = st;
      if (st.track?.uri === track.uri) setConn(st.paused ? { kind: 'paused' } : { kind: 'playing' });
    });
    const started = await p.play(track.uri, 0);
    if (!started.ok) setConn({ kind: 'error', message: started.issue === 'needs_tap' ? 'Tap play once more to start the music.' : started.message });
    setTaps([]);
  };

  const pause = () => {
    void currentPlayer()?.pause();
  };

  const tap = () => {
    const st = latest.current;
    if (!st || st.paused || st.track?.uri !== track.uri) return;
    const at = positionAt(st, Date.now());
    setTaps((t) => [...t.slice(-15), at]);
  };

  const open = () => {
    if (!beat) return;
    unsubscribe.current?.();
    unsubscribe.current = null;
    actions.openPlayAlong({ track, beat, beatsPerBar, key: KEYS.find((k) => k.value === keyValue)?.key ?? null });
  };

  const back = () => {
    stopSong();
    onBack();
  };

  const playing = conn.kind === 'playing';

  return (
    <section className={s.card} aria-label="Tap the beat">
      <NowPlaying track={track} />
      <Button variant="link" onClick={back}>
        Pick another song
      </Button>
      <span className={s.muted}>Play the song, then tap along on the beat at least 4 times.</span>

      {conn.kind === 'error' && (
        <p className={s.error} role="alert">
          {conn.message}
        </p>
      )}

      {playing ? (
        <Button onClick={pause}>Pause the song</Button>
      ) : (
        <Button onClick={() => void play()} disabled={conn.kind === 'connecting'}>
          {conn.kind === 'connecting' ? 'Connecting to Spotify…' : conn.kind === 'paused' ? 'Play from the start' : 'Play the song'}
        </Button>
      )}

      <Button className={s.tap} onPointerDown={tap} disabled={!playing}>
        Tap the beat
      </Button>

      <div role="status">
        {beat ? (
          <>
            <p className={s.readout}>{`${Math.round(beat.bpm)} bpm`}</p>
            <span className={s.muted}>{`${Math.round(beat.confidence * 100)}% sure, ${steadiness(beat.confidence)}`}</span>
          </>
        ) : (
          <span className={s.muted}>{taps.length ? `${taps.length} of 4 taps` : 'No taps yet'}</span>
        )}
      </div>

      <div className={s.options}>
        <label>
          Beats per bar
          <select className={s.field} value={beatsPerBar} onChange={(e) => setBeatsPerBar(Number(e.target.value) === 3 ? 3 : 4)}>
            <option value={4}>4</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          Key (adds bass and pad)
          <select className={s.field} value={keyValue} onChange={(e) => setKeyValue(e.target.value)}>
            <option value="">None</option>
            {KEYS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Button variant="primary" wide onClick={open} disabled={!beat || opening}>
        {opening ? 'Opening the room…' : 'Open the room'}
      </Button>
    </section>
  );
}
