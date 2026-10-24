import { gsap } from 'gsap';

// All motion lives here so screens stay declarative. Short, soft, and
// skipped entirely for people who ask for reduced motion.

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** New screen slides up into place; its top-level blocks follow in a light stagger. */
export function enterScreen(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
  const blocks = el.querySelectorAll(':scope > .stack > *, :scope > .lanes > *, :scope > .hero, :scope > .stack');
  if (blocks.length) {
    gsap.fromTo(blocks, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out', stagger: 0.04, delay: 0.06, clearProps: 'transform,opacity,visibility' });
  }
}

/** Avatars that just arrived pop in; `seen` remembers who was already on screen. */
export function popInNew(root: ParentNode, seen: Set<string>): void {
  const fresh: Element[] = [];
  const present = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-pid]')) {
    const id = el.dataset.pid ?? '';
    present.add(id);
    if (!seen.has(id)) fresh.push(el);
  }
  const firstPaint = seen.size === 0;
  seen.clear();
  for (const id of present) seen.add(id);
  if (!fresh.length || reduced()) return;
  gsap.fromTo(
    fresh,
    { scale: 0.4, autoAlpha: 0 },
    { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(2.2)', stagger: firstPaint ? 0.02 : 0, clearProps: 'transform,opacity,visibility' },
  );
}

/** The big note on the play surface thumps and the surface glows with the instrument tint. */
export function noteHit(note: HTMLElement, glow: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(note, { scale: 0.86 }, { scale: 1, duration: 0.3, ease: 'back.out(3)', overwrite: 'auto' });
  gsap.fromTo(glow, { opacity: 0.55 }, { opacity: 0, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
}

/** Coach-mark fades in, then its ring keeps pulsing until it is dismissed. */
export function coachIn(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.3 });
  const ring = el.querySelector('.coach-ring');
  if (ring) gsap.fromTo(ring, { scale: 0.6, opacity: 0.8 }, { scale: 1.6, opacity: 0, duration: 1.4, ease: 'power1.out', repeat: -1 });
}

export function coachOut(el: HTMLElement): void {
  gsap.killTweensOf([el, ...el.children]);
  if (reduced()) {
    el.remove();
    return;
  }
  gsap.to(el, { autoAlpha: 0, y: -6, duration: 0.2, ease: 'power1.in', onComplete: () => el.remove() });
}

/** A tap that can't play: a small sideways shake. */
export function dud(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { x: -7 }, { x: 0, duration: 0.35, ease: 'elastic.out(1.2, 0.35)', overwrite: 'auto' });
}

/** Ensemble view: a soft ring plus a few sparks where a player's note landed. */
export function burst(field: HTMLElement, maxLive = 12): void {
  if (field.childElementCount >= maxLive) return; // a busy lane is already lit up
  const x = 8 + Math.random() * 84;
  const y = 20 + Math.random() * 60;
  const ring = document.createElement('span');
  ring.className = 'ripple';
  ring.style.left = `${x}%`;
  ring.style.top = `${y}%`;
  field.appendChild(ring);
  if (reduced()) {
    setTimeout(() => ring.remove(), 300);
    return;
  }
  gsap.fromTo(ring, { scale: 0.2, opacity: 0.7 }, { scale: 6, opacity: 0, duration: 0.9, ease: 'power2.out', onComplete: () => ring.remove() });

  for (let i = 0; i < 4; i++) {
    const spark = document.createElement('span');
    spark.className = 'spark';
    spark.style.left = `${x}%`;
    spark.style.top = `${y}%`;
    field.appendChild(spark);
    const angle = (Math.PI / 2) * i + Math.random() * 0.8;
    const dist = 26 + Math.random() * 22;
    gsap.fromTo(
      spark,
      { x: 0, y: 0, opacity: 1, scale: 1 },
      { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 0.4, duration: 0.6, ease: 'power3.out', onComplete: () => spark.remove() },
    );
  }
}

/** A player's avatar bounces when their note echoes. */
export function bump(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { scale: 1.45 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)', overwrite: 'auto' });
}

/** A lane breathes on every note. */
export function lanePulse(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { '--glow': 1 }, { '--glow': 0, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
}
