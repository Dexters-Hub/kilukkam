import type { PlayerSnapshot, Score } from '@kilukkam/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { bump } from '../../lib/anim.js';
import { instrumentMeta } from '../../lib/music.js';
import { playersByTrack, pulseBumps } from '../../lib/store.js';
import { onLive } from '../../app/live.js';
import { Avatar } from '../../components/Avatar.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import s from './Play.module.css';

/** Dots shown per instrument in the room strip before collapsing into "+n" */
const ROOM_DOTS_PER_ROW = 12;
/** Most dots one row bumps per pulse, however hard that section is tapping */
const ROOM_BUMPS_PER_ROW = 4;

/**
 * A quiet strip of everyone else in the room, one row per instrument. It
 * renders when the roster changes; ensemble_pulse bumps dots through refs.
 */
export function RoomView({ players, piece, me }: { players: readonly PlayerSnapshot[]; piece: Score; me: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const groups = playersByTrack(players);
  const shown = new Map(piece.tracks.map((t) => [t.id, (groups.get(t.id) ?? []).slice(0, ROOM_DOTS_PER_ROW).map((p) => p.id)]));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(
    () =>
      onLive('pulse', (p) => {
        for (const id of pulseBumps(p.counts, shownRef.current, ROOM_BUMPS_PER_ROW)) {
          const dot = root.current?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(id)}"]`);
          if (dot) bump(dot);
        }
      }),
    [],
  );

  return (
    <div ref={root} className={s.room} aria-hidden="true">
      {piece.tracks.map((t) => {
        const ps = groups.get(t.id) ?? [];
        const extra = ps.length - ROOM_DOTS_PER_ROW;
        return (
          <div key={t.id} className={s.roomRow} style={{ '--tint': instrumentMeta(t.instrument).color } as CSSProperties}>
            <span className={s.roomLabel}>
              <Icon name={instrumentIcon(t.instrument)} size={14} />
            </span>
            {ps.slice(0, ROOM_DOTS_PER_ROW).map((p) => (
              <Avatar key={p.id} id={p.avatar} pid={p.id} size="xs" mine={p.id === me} away={!p.connected} />
            ))}
            {extra > 0 ? <span className={s.roomMore}>+{extra}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
