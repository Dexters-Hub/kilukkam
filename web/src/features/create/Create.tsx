import { PIECES } from '@kilukkam/shared';
import type { CSSProperties } from 'react';
import { instrumentMeta } from '../../lib/music.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { Hint, Screen, Title, TopBar } from '../../components/Screen.js';
import type { IconName } from '../../ui/icons.js';
import s from './Create.module.css';

/** Instrument glyph for a track; unknown instruments fall back to a note. */
export const instrumentIcon = (id: string): IconName => (id === 'violin' || id === 'cello' || id === 'flute' || id === 'piano' ? id : 'music-note');

export function Create() {
  const busy = useStore((st) => (st.intent?.kind === 'create' ? st.intent.pieceId : null));
  return (
    <Screen>
      <TopBar onBack={actions.goHome} />
      <Title>Pick a piece</Title>
      <Hint>You get a 4-letter code. Friends join with it and each picks an instrument.</Hint>
      <div className={cx(s.list, 'stack')}>
        {PIECES.map((p) => (
          <button key={p.id} type="button" className={cx(s.card, busy === p.id && s.busy)} disabled={busy !== null} onClick={() => actions.createRoom(p.id)}>
            <div>
              <h2 className={s.name}>{p.title}</h2>
              <span className={s.muted}>
                {p.composer} · {p.bpm} bpm
              </span>
            </div>
            <ul className={s.instruments}>
              {p.tracks.map((t) => (
                <li key={t.id} style={{ '--tint': instrumentMeta(t.instrument).color } as CSSProperties}>
                  <Icon name={instrumentIcon(t.instrument)} size={22} />
                  <span className={s.grow}>{t.name}</span>
                  <span className={s.muted}>up to {t.maxPlayers}</span>
                </li>
              ))}
            </ul>
            <span className={s.cta}>
              {busy === p.id ? 'Opening the room…' : 'Conduct this piece'}
              <Icon name="caret-right" size={14} />
            </span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
