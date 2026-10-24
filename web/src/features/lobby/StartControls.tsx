import { useState } from 'react';
import { readPref, writePref } from '../../ui/dom.js';
import { actions } from '../../app/controller.js';
import { Button, cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import s from './Lobby.module.css';

const COUNT_IN_PREF = 'kilukkam.countIn';

/** The conductor's one main action: start (or encore), with the count-in toggle beside it. */
export function StartControls({ players, label }: { players: number; label: string }) {
  const [countIn, setCountIn] = useState(() => readPref(COUNT_IN_PREF) !== '0');
  const toggle = () => {
    setCountIn(!countIn);
    writePref(COUNT_IN_PREF, countIn ? '0' : '1');
  };
  return (
    <div className={s.start}>
      <button type="button" role="switch" aria-checked={countIn} className={cx(s.switch, countIn && s.switchOn)} onClick={toggle}>
        <Icon name="timer" size={20} />
        <span>Count everyone in</span>
        <span className={s.knob} aria-hidden="true" />
      </button>
      <Button variant="primary" wide disabled={players < 1} onClick={() => actions.startPiece(countIn)}>
        {players < 1 ? 'Waiting for players…' : label}
      </Button>
    </div>
  );
}
