import type { Score } from '@kilukkam/shared';
import type { CSSProperties } from 'react';
import { cx } from '../../components/Button.js';
import { instrumentsOf } from './pieceMeta.js';
import s from './Cover.module.css';

// Album art for a piece, drawn from its own instruments: soft colour fields
// that drift, rings that breathe, and a sound wave across the middle. Every
// piece gets the same recipe with a different seed, so each cover is its own
// but they read as one set. While the piece previews, the art pulses on the beat.

const seeded = (text: string) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
};

export function Cover({ piece, playing = false, big = false }: { piece: Score; playing?: boolean; big?: boolean }) {
  const r = seeded(piece.id);
  const colors = instrumentsOf(piece).map((i) => `var(--${i})`);
  const blobs = Array.from({ length: 5 }, (_, i) => ({
    cx: 10 + r() * 80,
    cy: 10 + r() * 80,
    rad: 26 + r() * 30,
    color: colors[i % colors.length] ?? 'var(--accent)',
    delay: -r() * 12,
  }));
  // A smooth sound wave: two sines mixed, with a gentle swell in the middle.
  const f1 = 0.9 + r() * 0.8;
  const f2 = 2.6 + r() * 1.6;
  const phase = r() * 6;
  const wave = Array.from({ length: 121 }, (_, i) => {
    const u = i / 120;
    const swell = Math.sin(Math.PI * u);
    const y = 52 + swell * (9 * Math.sin(u * Math.PI * 2 * f1 + phase) + 4 * Math.sin(u * Math.PI * 2 * f2));
    return `${i ? 'L' : 'M'}${(u * 100).toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const beat = `${(60 / piece.bpm).toFixed(3)}s`;

  return (
    <div className={cx(s.cover, playing && s.playing, big && s.big)} style={{ '--beat': beat } as CSSProperties} aria-hidden="true">
      <svg className={s.art} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id={`blur-${piece.id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <rect width="100" height="100" fill="#0a0a0a" />
        <g filter={`url(#blur-${piece.id})`}>
          {blobs.map((b, i) => (
            <circle key={i} className={s.blob} cx={b.cx} cy={b.cy} r={b.rad} fill={b.color} style={{ animationDelay: `${b.delay}s` }} />
          ))}
        </g>
        <g className={s.rings} fill="none" stroke="#fff">
          {[14, 24, 34, 44].map((rad) => (
            <circle key={rad} cx="72" cy="30" r={rad} strokeOpacity={0.5 - rad / 110} strokeWidth="0.5" />
          ))}
        </g>
        <path className={s.wave} d={wave} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <div className={s.grain} />
    </div>
  );
}
