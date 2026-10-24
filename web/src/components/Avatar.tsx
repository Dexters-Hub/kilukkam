import { useState, type CSSProperties } from 'react';
import { CONDUCTOR_AVATAR, composerFor, portraitUrl } from '../data/composers.js';
import s from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarProps {
  id: string;
  size?: AvatarSize;
  /** Player name, for the accessible label */
  name?: string;
  /** Player id, so lib/anim can pop in new arrivals */
  pid?: string;
  mine?: boolean;
  away?: boolean;
}

/**
 * The one avatar disc used everywhere: a composer portrait over an era-tinted
 * monogram, the conductor's mark, or (for an id we don't know) the name's initial.
 */
export function Avatar({ id, size = 'md', name, pid, mine, away }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const composer = composerFor(id);
  const conductor = id === CONDUCTOR_AVATAR;
  const who = conductor ? 'Conductor' : (composer?.fullName ?? '');
  const label = [name, who].filter(Boolean).join(' · ') || 'Player';
  const mark = conductor ? CONDUCTOR_AVATAR : (composer?.monogram ?? [...(name ?? '?')][0] ?? '?');
  const cls = [s.av, s[size], composer ? s.composer : s.plain, mine && s.mine, away && s.away].filter(Boolean).join(' ');
  const style = composer ? ({ '--era': composer.eraColor } as CSSProperties) : undefined;
  return (
    <span className={cls} role="img" aria-label={label} title={label} data-pid={pid} data-wide={(composer?.monogram.length ?? 1) > 1 || undefined} style={style}>
      <span className={s.mono} aria-hidden="true">
        {mark}
      </span>
      {composer && !broken ? (
        <img className={s.portrait} src={portraitUrl(composer)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      ) : null}
    </span>
  );
}
