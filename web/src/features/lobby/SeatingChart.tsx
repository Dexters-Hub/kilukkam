import type { PlayerSnapshot, Score } from '@kilukkam/shared';
import type { CSSProperties } from 'react';
import { instrumentMeta } from '../../lib/music.js';
import { playersByTrack } from '../../lib/store.js';
import { Avatar } from '../../components/Avatar.js';
import s from './SeatingChart.module.css';

// The conductor's view of the room filling up: the orchestra in a half
// circle, one wedge per instrument, each player's avatar taking a seat in
// their section as they join. Empty seats are dashed, so the conductor can
// see at a glance which section still needs people.

const ROWS = [0.42, 0.62, 0.82] as const;
/** Seats drawn per section before the rest collapse into "+N" */
const SHOWN = 9;
const EMPTY = 3;

const polar = (u: number, r: number) => {
  const a = Math.PI * (1 + u);
  return { left: `${50 + 46 * r * Math.cos(a)}%`, top: `${92 + 84 * r * Math.sin(a)}%` };
};

export function SeatingChart({ piece, players }: { piece: Score; players: readonly PlayerSnapshot[] }) {
  const groups = playersByTrack(players);
  const n = Math.max(1, piece.tracks.length);
  const gap = 0.02;
  return (
    <div className={s.chart} aria-label="Seating chart">
      <svg className={s.wedges} viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        {piece.tracks.map((t, i) => {
          const u0 = i / n + gap / 2;
          const u1 = (i + 1) / n - gap / 2;
          const arc = (u: number, r: number) => {
            const a = Math.PI * (1 + u);
            return `${50 + 46 * r * Math.cos(a)} ${55.2 + 50.4 * r * Math.sin(a)}`;
          };
          const d = `M${arc(u0, 0.95)} A ${46 * 0.95} ${50.4 * 0.95} 0 0 1 ${arc(u1, 0.95)} L${arc(u1, 0.3)} A ${46 * 0.3} ${50.4 * 0.3} 0 0 0 ${arc(u0, 0.3)} Z`;
          return <path key={t.id} d={d} style={{ fill: `color-mix(in srgb, ${instrumentMeta(t.instrument).color} 14%, transparent)` }} />;
        })}
      </svg>
      {piece.tracks.map((t, i) => {
        const color = instrumentMeta(t.instrument).color;
        const ps = groups.get(t.id) ?? [];
        const shown = ps.slice(0, SHOWN);
        const empties = Math.max(0, Math.min(EMPTY, t.maxPlayers - ps.length, SHOWN - shown.length));
        const seats = [...shown.map((p) => ({ kind: 'player' as const, p })), ...Array.from({ length: empties }, (_, k) => ({ kind: 'empty' as const, k }))];
        const perRow = Math.ceil(Math.max(seats.length, 1) / ROWS.length);
        const label = polar((i + 0.5) / n, 1.02);
        return (
          <div key={t.id} className={s.section} style={{ '--tint': color } as CSSProperties}>
            <span className={s.label} style={label}>
              {t.name} <b>{ps.length}</b>
            </span>
            {seats.map((seat, k) => {
              const row = k % ROWS.length;
              const col = Math.floor(k / ROWS.length);
              const u = (i + (col + 0.5) / perRow) / n;
              const pos = polar(u, ROWS[ROWS.length - 1 - row] ?? 0.6);
              return seat.kind === 'player' ? (
                <span key={seat.p.id} className={s.seat} style={pos}>
                  <Avatar id={seat.p.avatar} name={seat.p.name} size="sm" away={!seat.p.connected} />
                </span>
              ) : (
                <span key={`empty-${seat.k}`} className={s.empty} style={pos} aria-hidden="true" />
              );
            })}
            {ps.length > SHOWN ? (
              <span className={s.more} style={polar((i + 0.5) / n, 0.26)}>
                +{ps.length - SHOWN}
              </span>
            ) : null}
          </div>
        );
      })}
      <span className={s.podium} aria-hidden="true">
        Conductor
      </span>
    </div>
  );
}
