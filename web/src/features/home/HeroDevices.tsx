import type { InstrumentId } from '@kilukkam/shared';
import { gsap } from 'gsap';
import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon.js';
import { INSTRUMENTS } from '../../lib/music.js';
import s from './HeroDevices.module.css';

// The landing page's product shot: the conductor's laptop at the back with the
// room code and the seating chart, and four phones fanned in front, each
// running its own part. The visitor's phone sits in front. Idle, the other
// phones keep playing on the beat (CSS); a real tap lands on the visitor's
// phone and a note flies up to their seat on the laptop (GSAP).

export const HERO_ORDER: readonly InstrumentId[] = ['flute', 'violin', 'guitar', 'piano', 'cello', 'drums'];

export interface HeroDevicesHandle {
  hit(label: string): void;
}

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tint = (id: InstrumentId) => ({ '--tint': INSTRUMENTS[id].color }) as CSSProperties;

export const HeroDevices = forwardRef<HeroDevicesHandle, { mine: InstrumentId; next: string }>(function HeroDevices({ mine, next }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const others = HERO_ORDER.filter((i) => i !== mine);

  useImperativeHandle(ref, () => ({
    hit(label) {
      const host = root.current;
      if (!host) return;
      const phone = host.querySelector<HTMLElement>(`[data-phone="${mine}"]`);
      const seat = host.querySelector<HTMLElement>(`[data-seat="${mine}"]`);
      const ring = phone?.querySelector<HTMLElement>('[data-ring]');
      if (!phone || !seat || !ring) return;
      if (reduced()) return;
      gsap.fromTo(ring, { scale: 1.35, opacity: 1 }, { scale: 1, opacity: 0.7, duration: 0.45, ease: 'expo.out' });
      gsap.fromTo(phone, { y: 6 }, { y: 0, duration: 0.5, ease: 'elastic.out(1, 0.45)' });
      // Sparks out of the ring.
      const box = host.getBoundingClientRect();
      const r = ring.getBoundingClientRect();
      const cx = r.left + r.width / 2 - box.left;
      const cy = r.top + r.height / 2 - box.top;
      for (let i = 0; i < 12; i++) {
        const spark = document.createElement('span');
        spark.className = s.spark ?? '';
        spark.style.left = `${cx}px`;
        spark.style.top = `${cy}px`;
        host.append(spark);
        const a = (i / 12) * Math.PI * 2;
        gsap.to(spark, { x: Math.cos(a) * 46, y: Math.sin(a) * 46 - 10, opacity: 0, scale: 0.3, duration: 0.6, ease: 'power3.out', onComplete: () => spark.remove() });
      }
      // The note flies from the phone to its seat on the laptop.
      const t = seat.getBoundingClientRect();
      const note = document.createElement('span');
      note.className = s.flying ?? '';
      note.textContent = label;
      note.style.left = `${cx}px`;
      note.style.top = `${cy}px`;
      host.append(note);
      gsap
        .timeline({ onComplete: () => note.remove() })
        .fromTo(note, { scale: 0.6, opacity: 0 }, { scale: 1.1, opacity: 1, duration: 0.18, ease: 'back.out(3)' })
        .to(note, { x: t.left + t.width / 2 - box.left - cx, y: t.top + t.height / 2 - box.top - cy, scale: 0.5, duration: 0.55, ease: 'power2.in' })
        .to(note, { opacity: 0, duration: 0.12 });
      gsap.fromTo(seat, { scale: 1.8 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', delay: 0.7 });
    },
  }));

  return (
    <div ref={root} className={s.scene} aria-hidden="true">
      <div className={s.laptop}>
        <div className={s.screen}>
          <div className={s.codeCard}>
            <span>Room code</span>
            <b>KOCH</b>
          </div>
          <div className={s.chart}>
            {HERO_ORDER.map((id, i) => (
              <span key={id} className={s.wedge} style={{ ...tint(id), '--i': i } as CSSProperties}>
                {Array.from({ length: 5 }, (_, k) => (
                  <i key={k} className={s.seat} data-seat={k === 2 ? id : undefined} />
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className={s.base} />
      </div>
      <div className={s.phones}>
        {[...others.slice(0, 2), mine, ...others.slice(2)].map((id, i, all) => {
          const mid = (all.length - 1) / 2;
          const you = id === mine;
          return (
            <div
              key={id}
              className={`${s.phone} ${you ? s.you : ''}`}
              data-phone={id}
              style={{ ...tint(id), '--i': i, '--rot': `${(i - mid) * 8}deg`, '--lift': `${Math.abs(i - mid) * 7}%` } as CSSProperties}
            >
              <span className={s.phoneTop}>
                <Icon name={id} size={14} />
                {INSTRUMENTS[id].label}
              </span>
              <span className={s.lane}>
                <i className={s.gem} />
                <i className={s.gem} />
              </span>
              <span className={s.ring} data-ring />
              <span className={s.now}>{you ? next : '♪'}</span>
              {you ? <span className={s.youTag}>You</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});
