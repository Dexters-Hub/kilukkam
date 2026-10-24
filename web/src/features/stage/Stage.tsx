import { MAX_BPM, MIN_BPM } from '@kilukkam/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { actions } from '../../app/controller.js';
import { DYNAMICS, DYNAMICS_LABEL, clampBpm } from '../../app/cues.js';
import { useStore } from '../../app/useStore.js';
import { onLive } from '../../app/live.js';
import { bell } from '../../lib/audio.js';
import { holdWakeLock } from '../../app/wakeLock.js';
import { Button, cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { Dock, Screen } from '../../components/Screen.js';
import { chosenPlayAlong } from '../../app/playalong.js';
import { PLAYALONG_ID } from '../../lib/spotify/playalong.js';
import { NowPlaying } from '../create/NowPlaying.js';
import { CameraConductor } from './CameraConductor.js';
import { Lanes } from './Lanes.js';
import s from './Stage.module.css';

/**
 * Conductor's desk while the piece plays: live lanes and the camera, then
 * expression, tempo and DJ cues. With the camera on, gestures drive all of
 * it: the panel turns into live readouts and the buttons fold away behind
 * "No camera? Use buttons".
 */
export function Stage() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const totalRef = useRef<HTMLSpanElement>(null);
  const notes = useRef(0);
  const [draft, setDraft] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [camera, setCamera] = useState(false);
  const [dj, setDj] = useState<{ cue: 'build' | 'drop' | 'kilukkam'; at: number } | null>(null);
  const onCamera = useCallback((on: boolean) => setCamera(on), []);
  const song = chosenPlayAlong();

  useEffect(() => holdWakeLock(), []);
  // Loops and one-shot cues come back from the room, whether a button or a gesture gave them.
  useEffect(
    () =>
      onLive('dj', (e) => {
        if (e.cue === 'loop_on') setLooping(true);
        else if (e.cue === 'loop_off') setLooping(false);
        else setDj({ cue: e.cue, at: Date.now() });
      }),
    [],
  );
  // Kilukkam rings on the stage too, with the phones.
  useEffect(
    () =>
      onLive('kilukkam', () => {
        bell();
        setDj({ cue: 'kilukkam', at: Date.now() });
      }),
    [],
  );
  useEffect(() => {
    if (!dj) return;
    const id = setTimeout(() => setDj(null), 2500);
    return () => clearTimeout(id);
  }, [dj]);

  if (!snap || !piece) return null;
  const paused = snap.paused !== null;
  const roomBpm = snap.paused?.bpm ?? snap.tempo?.bpm ?? piece.bpm;
  const bpm = draft ?? roomBpm;
  const commit = () => setDraft(null);
  const onNote = () => {
    notes.current++;
    if (totalRef.current) totalRef.current.textContent = `${notes.current.toLocaleString()} ${notes.current === 1 ? 'note' : 'notes'}`;
  };

  return (
    <Screen className={s.screen}>
      <header className={s.top}>
        <div className={s.brand}>
          <span className={s.live} aria-hidden="true" />
          <span className={s.title}>{piece.title}</span>
        </div>
        <span ref={totalRef} className={s.count}>
          0 notes
        </span>
      </header>

      {song && piece.id === PLAYALONG_ID ? <NowPlaying track={song.track} compact /> : null}

      <div className={s.desk}>
        <Lanes piece={piece} players={snap.players} muted={snap.mutedTracks} onNote={onNote} />
        <CameraConductor room={{ piece, paused, muted: snap.mutedTracks, dynamics: snap.dynamics }} onCamera={onCamera} />
      </div>

      {camera ? (
        <section className={s.panel} aria-label="Live from the camera">
          <span className={s.label}>
            Dynamics <output className={s.bpm}>{DYNAMICS_LABEL[snap.dynamics]}</output>
          </span>
          <div className={cx(s.dynamics, s.readout)} aria-hidden="true">
            {DYNAMICS.map((level) => (
              <span key={level} className={cx(snap.dynamics === level && s.on)}>
                {level}
              </span>
            ))}
          </div>
          <span className={s.label}>
            Tempo <output className={s.bpm}>{roomBpm} bpm</output>
          </span>
          <div className={s.meter} aria-hidden="true">
            <div className={s.meterFill} style={{ width: `${((roomBpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 100}%` }} />
            <div className={s.meterMark} style={{ left: `${((piece.bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 100}%` }} />
          </div>
          <div className={s.scale}>
            <span>{MIN_BPM}</span>
            <span>As written {piece.bpm}</span>
            <span>{MAX_BPM}</span>
          </div>
          <span className={s.label}>Room</span>
          <div className={s.cues} role="status">
            <span className={cx(s.cue, paused && s.on)}>
              <Icon name="hand-tap" size={24} />
              {paused ? 'Paused' : 'Playing'}
            </span>
            <span className={cx(s.cue, dj !== null && s.on)}>
              <Icon name={dj?.cue === 'drop' ? 'speaker-slash' : dj?.cue === 'kilukkam' ? 'bell-ringing' : 'waveform'} size={24} />
              {dj ? { drop: 'Drop', build: 'Build', kilukkam: 'Kilukkam!' }[dj.cue] : 'Build, drop or bell'}
            </span>
            <span className={cx(s.cue, looping && s.on)}>
              <Icon name="arrows-clockwise" size={24} />
              {looping ? 'Looping' : 'No loop'}
            </span>
          </div>
        </section>
      ) : null}

      <Fallback folded={camera}>
      <section className={s.panel} aria-label="Room">
        <Button variant="surface" onClick={paused ? actions.resumePiece : actions.pausePiece}>
          <Icon name={paused ? 'play' : 'hand-tap'} size={20} />
          {paused ? 'Play on' : 'Pause the room'}
        </Button>
      </section>

      <section className={s.panel} aria-label="Expression">
        <span className={s.label}>Dynamics</span>
        <div className={s.dynamics} role="radiogroup" aria-label="Dynamics">
          {DYNAMICS.map((level) => (
            <button key={level} type="button" role="radio" aria-checked={snap.dynamics === level} aria-label={DYNAMICS_LABEL[level]} className={cx(snap.dynamics === level && s.on)} onClick={() => actions.setDynamics(level)}>
              {level}
            </button>
          ))}
        </div>
      </section>

      <section className={s.panel} aria-label="Tempo">
        <label className={s.label} htmlFor="tempo">
          Tempo <output className={s.bpm}>{bpm} bpm</output>
        </label>
        <input
          id="tempo"
          className={s.slider}
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          onChange={(e) => {
            const v = clampBpm(Number(e.target.value), MIN_BPM, MAX_BPM);
            setDraft(v);
            actions.setTempo(v);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <div className={s.scale}>
          <span>{MIN_BPM}</span>
          <button type="button" className={s.reset} onClick={() => actions.setTempo(piece.bpm)} disabled={roomBpm === piece.bpm}>
            As written ({piece.bpm})
          </button>
          <span>{MAX_BPM}</span>
        </div>
      </section>

      <section className={s.panel} aria-label="DJ cues">
        <span className={s.label}>Cues</span>
        <div className={s.cues}>
          <button type="button" className={s.cue} onClick={() => actions.dj('drop')}>
            <Icon name="speaker-slash" size={24} />
            Drop
          </button>
          <button type="button" className={s.cue} onClick={() => actions.dj('build')}>
            <Icon name="waveform" size={24} />
            Build
          </button>
          <button
            type="button"
            className={cx(s.cue, looping && s.on)}
            aria-pressed={looping}
            onClick={() => actions.dj(looping ? 'loop_off' : 'loop_on')}
          >
            <Icon name="arrows-clockwise" size={24} />
            {looping ? 'Unloop' : 'Loop bar'}
          </button>
        </div>
      </section>
      </Fallback>

      <Dock>
        <Button variant="dark" wide onClick={actions.stopPiece}>
          <Icon name="stop" size={20} />
          Stop the piece
        </Button>
      </Dock>
    </Screen>
  );
}

/** With the camera on, the buttons fold into a small fallback; without it, they are the controls. */
function Fallback({ folded, children }: { folded: boolean; children: ReactNode }) {
  if (!folded) return <>{children}</>;
  return (
    <details className={s.fallback}>
      <summary>No camera? Use buttons</summary>
      <div className={s.fallbackBody}>{children}</div>
    </details>
  );
}
