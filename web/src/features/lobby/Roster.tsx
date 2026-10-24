import type { PlayerSnapshot, Track } from '@kilukkam/shared';
import { useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { instrumentMeta } from '../../lib/music.js';
import { actions } from '../../app/controller.js';
import { Avatar } from '../../components/Avatar.js';
import { cx } from '../../components/Button.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import s from './Lobby.module.css';

const DRAG_TYPE = 'application/x-kilukkam-player';

/** Makes a player row or dot draggable onto another section. */
export const dragSource = (playerId: string) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG_TYPE, playerId),
});

/** Rows drop onto another section to reassign; `null` is "still choosing". */
export const dropTarget = (trackId: string | null, onHover: (on: boolean) => void) => ({
  onDragOver: (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onHover(true);
  },
  onDragLeave: () => onHover(false),
  onDrop: (e: DragEvent) => {
    onHover(false);
    const playerId = e.dataTransfer.getData(DRAG_TYPE);
    if (!playerId) return;
    e.preventDefault();
    actions.assignTrack(playerId, trackId);
  },
});

/** Kicking is two taps: the first arms it for 3 s, a second tap confirms. */
function useArmed(): [string | null, (id: string | null) => void] {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, setArmed];
}

interface RosterProps {
  title: ReactNode;
  tint: string;
  capacity: string;
  trackId: string | null;
  players: readonly PlayerSnapshot[];
  tracks: readonly Track[];
}

/** One section of the conductor's seating chart. Rows drag between sections, or use the Move picker on touch. */
export function Roster({ title, tint, capacity, trackId, players, tracks }: RosterProps) {
  const [over, setOver] = useState(false);
  const [armed, setArmed] = useArmed();
  const [moving, setMoving] = useState<string | null>(null);
  return (
    <section className={cx(s.roster, over && s.over)} style={{ '--tint': tint } as CSSProperties} {...dropTarget(trackId, setOver)}>
      <div className={s.rosterHead}>
        <strong>{title}</strong>
        <span className={s.count}>{capacity}</span>
      </div>
      {players.length ? (
        <ul className={s.rosterList}>
          {players.map((p) => (
            <li key={p.id} data-pid={p.id} className={cx(!p.connected && s.away)} {...dragSource(p.id)}>
              <div className={s.row}>
                <Avatar id={p.avatar} name={p.name} away={!p.connected} />
                <span className={s.name}>{p.name}</span>
                <button
                  type="button"
                  className={cx(s.rowAction, moving === p.id && s.rowActionOn)}
                  aria-expanded={moving === p.id}
                  aria-label={`Move ${p.name} to another instrument`}
                  onClick={() => setMoving(moving === p.id ? null : p.id)}
                >
                  {moving === p.id ? 'Done' : 'Move'}
                </button>
                <button
                  type="button"
                  className={cx(s.rowAction, s.remove, armed === p.id && s.armed)}
                  aria-label={armed === p.id ? `Confirm remove ${p.name}` : `Remove ${p.name}`}
                  onClick={() => {
                    if (armed === p.id) {
                      setArmed(null);
                      actions.kick(p.id);
                    } else setArmed(p.id);
                  }}
                >
                  {armed === p.id ? 'Remove?' : 'Remove'}
                </button>
              </div>
              {moving === p.id ? (
                <div className={s.picker} role="group" aria-label={`Move ${p.name} to`}>
                  {tracks
                    .filter((t) => t.id !== trackId)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={s.chip}
                        style={{ '--tint': instrumentMeta(t.instrument).color } as CSSProperties}
                        onClick={() => {
                          setMoving(null);
                          actions.assignTrack(p.id, t.id);
                        }}
                      >
                        <Icon name={instrumentIcon(t.instrument)} size={18} />
                        {t.name}
                      </button>
                    ))}
                  {trackId !== null ? (
                    <button
                      type="button"
                      className={s.chip}
                      onClick={() => {
                        setMoving(null);
                        actions.assignTrack(p.id, null);
                      }}
                    >
                      Let them choose
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.empty}>{over ? 'Drop to move here' : 'Nobody yet'}</p>
      )}
    </section>
  );
}
