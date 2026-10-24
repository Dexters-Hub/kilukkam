import { MAX_BPM, MIN_BPM } from '@kilukkam/shared';
import { useEffect, useRef, useState } from 'react';
import { actions } from '../../app/controller.js';
import { DYNAMICS, DYNAMICS_LABEL, clampBpm } from '../../app/cues.js';
import { useStore } from '../../app/useStore.js';
import { holdWakeLock } from '../../app/wakeLock.js';
import { Button, cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { Dock, Screen } from '../../components/Screen.js';
import { Lanes } from './Lanes.js';
import s from './Stage.module.css';

/** Conductor's desk while the piece plays: live lanes, then expression, tempo and DJ cues. */
export function Stage() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const totalRef = useRef<HTMLSpanElement>(null);
  const notes = useRef(0);
  const [draft, setDraft] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);

  useEffect(() => holdWakeLock(), []);

  if (!snap || !piece) return null;
  const roomBpm = snap.tempo?.bpm ?? piece.bpm;
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

      <Lanes piece={piece} players={snap.players} muted={snap.mutedTracks} onNote={onNote} />

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
            onClick={() => {
              actions.dj(looping ? 'loop_off' : 'loop_on');
              setLooping(!looping);
            }}
          >
            <Icon name="arrows-clockwise" size={24} />
            {looping ? 'Unloop' : 'Loop bar'}
          </button>
        </div>
      </section>

      <Dock>
        <Button variant="dark" wide onClick={actions.stopPiece}>
          <Icon name="stop" size={20} />
          Stop the piece
        </Button>
      </Dock>
    </Screen>
  );
}
