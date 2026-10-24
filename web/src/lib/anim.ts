import { gsap } from 'gsap';

// All motion lives here so screens stay declarative. Short, soft, and
// skipped entirely for people who ask for reduced motion.

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** New screen slides up into place; its top-level blocks follow in a light stagger. */
export function enterScreen(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { autoAlpha: 0, y: 22, filter: 'blur(6px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out', clearProps: 'transform,opacity,visibility,filter' });
  const blocks = el.querySelectorAll(':scope > .stack > *, :scope > .lanes > *, :scope > .hero, :scope > .stack');
  if (blocks.length) {
    gsap.fromTo(blocks, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.05, delay: 0.08, clearProps: 'transform,opacity,visibility' });
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

/** The combo number punches up each time it grows. */
export function comboPunch(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { scale: 1.55, y: -3 }, { scale: 1, y: 0, duration: 0.42, ease: 'back.out(3.2)', overwrite: 'auto' });
}

/** A tap that missed the beat: the note name dims and shivers, then settles. Gentle, never a scolding. */
export function missShake(el: HTMLElement): void {
  if (reduced()) {
    gsap.fromTo(el, { opacity: 0.5 }, { opacity: 1, duration: 0.3, overwrite: 'auto' });
    return;
  }
  gsap.fromTo(el, { x: -9, opacity: 0.45 }, { x: 0, opacity: 1, duration: 0.4, ease: 'elastic.out(1.1, 0.3)', overwrite: 'auto' });
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

/** Cards fade up the first time they scroll into view. */
export function revealOnScroll(els: Iterable<Element>): void {
  const list = [...els];
  if (reduced() || !list.length || !('IntersectionObserver' in window)) return;
  gsap.set(list, { autoAlpha: 0, y: 28 });
  const io = new IntersectionObserver(
    (entries) => {
      const batch = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      if (!batch.length) return;
      for (const el of batch) io.unobserve(el);
      gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.07, overwrite: true, clearProps: 'transform' });
    },
    { rootMargin: '0px 0px -40px 0px' },
  );
  for (const el of list) io.observe(el);
}

/** A number ticks up from zero when it scrolls into view. */
export function countUp(el: HTMLElement, value: number): void {
  el.textContent = reduced() ? value.toLocaleString() : '0';
  if (reduced() || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return;
    io.disconnect();
    const n = { v: 0 };
    gsap.to(n, { v: value, duration: 1.4, ease: 'power2.out', onUpdate: () => (el.textContent = Math.round(n.v).toLocaleString()) });
  });
  io.observe(el);
}

/** A ring expands out of a tap point, in the current tint. */
export function ring(host: HTMLElement): void {
  if (reduced()) return;
  const r = document.createElement('span');
  r.className = 'tap-ring';
  host.append(r);
  gsap.fromTo(r, { scale: 0.6, opacity: 0.55 }, { scale: 2.6, opacity: 0, duration: 0.9, ease: 'power2.out', onComplete: () => r.remove() });
}

/** A note glyph drifts up and fades, like a sound leaving the phone. */
export function floatNote(host: HTMLElement, glyph = '♪'): void {
  if (reduced() || host.childElementCount > 24) return;
  const n = document.createElement('span');
  n.className = 'float-note';
  n.textContent = glyph;
  n.style.left = `${20 + Math.random() * 60}%`;
  host.append(n);
  gsap.fromTo(
    n,
    { y: 0, x: 0, opacity: 0.9, rotate: -10 + Math.random() * 20, scale: 0.8 },
    { y: -120 - Math.random() * 60, x: -30 + Math.random() * 60, opacity: 0, scale: 1.3, duration: 1.6, ease: 'power1.out', onComplete: () => n.remove() },
  );
}

/** Endless horizontal drift of a row that is rendered twice back to back. Returns a stop function. */
export function marquee(track: HTMLElement, secondsPerLoop = 40): () => void {
  if (reduced()) return () => {};
  const tween = gsap.to(track, { xPercent: -50, duration: secondsPerLoop, ease: 'none', repeat: -1 });
  return () => tween.kill();
}

/** Text swaps with a soft blur, used for the rotating hero word. */
export function swapText(el: HTMLElement, text: string): void {
  if (reduced()) {
    el.textContent = text;
    return;
  }
  gsap
    .timeline()
    .to(el, { yPercent: -35, opacity: 0, filter: 'blur(6px)', duration: 0.3, ease: 'power2.in' })
    .call(() => {
      el.textContent = text;
    })
    .fromTo(el, { yPercent: 35, opacity: 0, filter: 'blur(6px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out' });
}

/**
 * The landing page's first second: the headline arrives word by word on a
 * spring, the instrument word wipes in like a
 * marker stroke, then the lead, the code box and the stage follow.
 */
export function heroIntro(root: HTMLElement): void {
  if (reduced()) return;
  const q = <T extends Element>(sel: string) => root.querySelectorAll<T>(sel);
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.fromTo(q('[data-intro="word"]'), { yPercent: 70, opacity: 0, rotate: 4 }, { yPercent: 0, opacity: 1, rotate: 0, duration: 0.9, stagger: 0.07, ease: 'back.out(1.6)', clearProps: 'all' });
  tl.fromTo(q('[data-intro="marker"]'), { clipPath: 'inset(0 100% 0 0 round .16em)' }, { clipPath: 'inset(0 0% 0 0 round .16em)', duration: 0.7, ease: 'power3.inOut', clearProps: 'clipPath' }, '-=0.5');
  tl.fromTo(q('[data-intro="rise"]'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.08, clearProps: 'all' }, '-=0.45');
  tl.fromTo(q('[data-intro="stage"]'), { y: 40, scale: 0.94, opacity: 0, rotate: -1.5 }, { y: 0, scale: 1, opacity: 1, rotate: 0, duration: 1.1, ease: 'expo.out', clearProps: 'all' }, 0.25);
}
