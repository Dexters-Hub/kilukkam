import { useGSAP } from '@gsap/react';
import { useRef, type CSSProperties } from 'react';
import type { PlayerResult, Score } from '@kilukkam/shared';
import { breathe, podiumReveal } from '../../lib/anim.js';
import { instrumentMeta } from '../../lib/music.js';
import { Avatar } from '../../components/Avatar.js';
import { cx } from '../../components/Button.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import s from './Leaderboard.module.css';

// The room leaderboard on the ended screen. Names and avatars come from the
// server's own record of each player and reach the DOM as React children only.

const pct = (accuracy: number): string => `${Math.round(accuracy * 100)}%`;

/** Instrument name, glyph and tint for a player's part */
function partOf(piece: Score | null, trackId: string) {
  const track = piece?.tracks.find((t) => t.id === trackId);
  const instrument = track?.instrument ?? '';
  return { name: track?.name ?? instrumentMeta(instrument).label, icon: instrumentIcon(instrument), color: instrumentMeta(instrument).color };
}

const tint = (color: string) => ({ '--tint': color }) as CSSProperties;

/** The 1.5 s grace while the phones' tallies come in */
export function Counting() {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    if (ref.current) breathe(ref.current);
  }, { scope: ref });
  return (
    <div className={s.counting} role="status">
      <span ref={ref} className={s.countingIcon}>
        <Icon name="trophy" size={26} />
      </span>
      Counting the scores…
    </div>
  );
}

/** Conductor: the top three on a podium (second, first, third), then everyone else ranked. */
export function Podium({ players, piece }: { players: readonly PlayerResult[]; piece: Score | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (ref.current) podiumReveal(ref.current);
  }, { scope: ref, dependencies: [players] });
  const [first, second, third] = players;
  const stand = [second, first, third].filter((p): p is PlayerResult => p !== undefined);
  return (
    <div ref={ref} className={s.board}>
      <ol className={s.podium} aria-label="Top three">
        {stand.map((p) => {
          const part = partOf(piece, p.trackId);
          const best = p.rank === 1;
          return (
            <li key={p.playerId} className={cx(s.place, s[`r${p.rank}`])} style={tint(part.color)} value={p.rank}>
              <div className={s.who} data-podium="who" data-rank={p.rank}>
                <span className={s.avatar}>
                  {best ? (
                    <span className={s.crown} data-podium="crown">
                      <Icon name="crown-simple" size={22} />
                    </span>
                  ) : null}
                  <Avatar id={p.avatar} name={p.name} size={best ? 'lg' : 'md'} />
                </span>
                <b className={s.name}>{p.name}</b>
                <span className={s.part}>
                  <Icon name={part.icon} size={16} />
                  {part.name}
                </span>
                {best ? <span className={s.best}>Best musician</span> : null}
              </div>
              <div className={s.block} data-podium="block" data-rank={p.rank}>
                <span className={s.rankNo}>{p.rank}</span>
                <b className={s.score}>{p.score}</b>
                <span className={s.meta}>pts, {pct(p.accuracy)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {players.length > 3 ? <RankList players={players.slice(3)} piece={piece} /> : null}
    </div>
  );
}

/** A compact ranked list; `mine` lights up this phone's own line. */
export function RankList({ players, piece, mine }: { players: readonly PlayerResult[]; piece: Score | null; mine?: string | null }) {
  return (
    <ol className={s.list}>
      {players.map((p) => {
        const part = partOf(piece, p.trackId);
        return (
          <li key={p.playerId} className={cx(s.row, p.playerId === mine && s.mine)} style={tint(part.color)} data-podium="row" value={p.rank}>
            <span className={cx(s.rowRank, p.rank === 1 && s.rowFirst)}>
              {p.rank === 1 ? <Icon name="crown-simple" size={18} /> : p.rank}
            </span>
            <Avatar id={p.avatar} name={p.name} size="sm" />
            <span className={s.rowWho}>
              <b>{p.name}</b>
              <span className={s.rowPart}>
                <Icon name={part.icon} size={14} />
                {part.name}
              </span>
            </span>
            <span className={s.rowScore}>
              <b>{p.score}</b>
              <span>{pct(p.accuracy)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Phone: where this player finished, crowned when they are the Best musician. */
export function Placement({ me, of }: { me: PlayerResult; of: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (ref.current) podiumReveal(ref.current);
  }, { scope: ref, dependencies: [me.rank] });
  const best = me.rank === 1;
  return (
    <div ref={ref} className={cx(s.placement, best && s.placementBest)} data-podium="row" role="status">
      {best ? (
        <span className={s.placementCrown} data-podium="crown">
          <Icon name="crown-simple" size={30} />
        </span>
      ) : null}
      <span className={s.placementText}>
        {best ? <span className={s.best}>Best musician</span> : null}
        <span className={s.placed}>
          You placed <b>#{me.rank}</b> of {of}
        </span>
      </span>
      <span className={s.placementScore}>
        <b>{me.score}</b>
        <span>pts</span>
      </span>
    </div>
  );
}
