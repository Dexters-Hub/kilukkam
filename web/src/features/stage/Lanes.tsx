import type { PlayerSnapshot, Score } from '@kilukkam/shared';
import { useGSAP } from '@gsap/react';
import { useRef, useState, type CSSProperties } from 'react';
import { bump, burst, lanePulse, popInNew } from '../../lib/anim.js';
import { instrumentMeta } from '../../lib/music.js';
import { playersByTrack } from '../../lib/store.js';
import { actions } from '../../app/controller.js';
import { onLive } from '../../app/live.js';
import { Avatar } from '../../components/Avatar.js';
import { cx } from '../../components/Button.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import { dragSource, dropTarget } from '../lobby/Roster.js';
import s from './Stage.module.css';

interface LaneRefs {
  el: HTMLElement;
  field: HTMLElement;
  fill: HTMLElement;
  length: number;
  furthest: number;
}

/**
 * One lane per instrument. React draws them when the roster changes; every
 * note_echo bumps the player's dot and throws a ripple across the lane,
 * straight through refs and GSAP.
 */
export function Lanes({ piece, players, muted, onNote }: { piece: Score; players: readonly PlayerSnapshot[]; muted: readonly string[]; onNote: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const lanes = useRef(new Map<string, LaneRefs>());
  const seen = useRef(new Set<string>());
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;
  const [over, setOver] = useState<string | null>(null);
  const groups = playersByTrack(players);

  useGSAP(() => {
    if (root.current) popInNew(root.current, seen.current);
  }, { dependencies: [players], scope: root });

  useGSAP((_ctx, contextSafe) => {
    const safe = contextSafe ?? (<T,>(fn: T) => fn);
    return onLive(
      'echo',
      safe((e: { playerId: string; trackId: string; noteIndex: number }) => {
        const lane = lanes.current.get(e.trackId);
        if (!lane) return;
        onNoteRef.current();
        lane.furthest = Math.max(lane.furthest, e.noteIndex + 1);
        lane.fill.style.width = `${Math.min(100, (lane.furthest / Math.max(1, lane.length)) * 100)}%`;
        lanePulse(lane.el);
        const dot = lane.el.querySelector<HTMLElement>(`[data-pid="${CSS.escape(e.playerId)}"]`);
        if (dot) bump(dot);
        burst(lane.field);
      }),
    );
  }, { scope: root });

  return (
    <div ref={root} className={s.lanes}>
      {piece.tracks.map((t) => {
        const m = instrumentMeta(t.instrument);
        const ps = groups.get(t.id) ?? [];
        const isMuted = muted.includes(t.id);
        return (
          <section
            key={t.id}
            className={cx(s.lane, isMuted && s.muted, over === t.id && s.over)}
            style={{ '--tint': m.color } as CSSProperties}
            ref={(el) => {
              if (!el) return;
              const prev = lanes.current.get(t.id);
              const field = el.querySelector<HTMLElement>('[data-field]');
              const fill = el.querySelector<HTMLElement>('[data-fill]');
              if (field && fill) lanes.current.set(t.id, { el, field, fill, length: t.events.length, furthest: prev?.furthest ?? 0 });
            }}
            {...dropTarget(t.id, (on) => setOver(on ? t.id : null))}
          >
            <div className={s.field} data-field aria-hidden="true" />
            <div className={s.laneHead}>
              <strong className={s.laneName}>
                <Icon name={instrumentIcon(t.instrument)} size={20} />
                {t.name}
              </strong>
              <span className={s.count}>{isMuted ? 'Resting' : `${ps.length} playing`}</span>
              <button
                type="button"
                className={s.mute}
                aria-pressed={isMuted}
                aria-label={isMuted ? `Bring ${t.name} back in` : `Rest ${t.name}`}
                onClick={() => actions.setSection(t.id, !isMuted)}
              >
                <Icon name={isMuted ? 'speaker-slash' : 'speaker-high'} size={22} />
              </button>
            </div>
            <div className={s.dots}>
              {ps.map((p) => (
                <span key={p.id} {...dragSource(p.id)}>
                  <Avatar id={p.avatar} name={p.name} pid={p.id} size="sm" away={!p.connected} />
                </span>
              ))}
            </div>
            <div className={s.track} aria-hidden="true">
              <div className={s.fill} data-fill />
            </div>
          </section>
        );
      })}
    </div>
  );
}
