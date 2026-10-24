import { gsap } from 'gsap';

// Cue motion for the play surface: big words that land and fade. Same rules
// as lib/anim: short, soft, and skipped for people who ask for reduced motion.

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A word lands in the middle of the surface, holds, then fades. */
export function flashCue(el: HTMLElement, text: string, holdS = 0.9): void {
  el.textContent = text;
  gsap.killTweensOf(el);
  if (reduced()) {
    gsap.set(el, { autoAlpha: 1 });
    gsap.set(el, { autoAlpha: 0, delay: holdS + 0.4 });
    return;
  }
  gsap
    .timeline()
    .fromTo(el, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.28, ease: 'back.out(2.4)' })
    .to(el, { autoAlpha: 0, scale: 1.08, duration: 0.4, ease: 'power2.in' }, `+=${holdS}`);
}

/** The surface goes dark for a drop and comes back on the bar. */
export function blackout(el: HTMLElement, seconds: number): void {
  gsap.killTweensOf(el);
  gsap.set(el, { autoAlpha: 0.88 });
  gsap.to(el, { autoAlpha: 0, duration: reduced() ? 0.01 : 0.25, delay: Math.max(0, seconds), ease: 'power1.out' });
}

/** A build: light rises from the bottom of the surface over the build. */
export function rise(el: HTMLElement, seconds: number): void {
  gsap.killTweensOf(el);
  if (reduced()) return;
  gsap.fromTo(el, { autoAlpha: 0, yPercent: 60 }, { autoAlpha: 0.8, yPercent: 0, duration: Math.max(0.3, seconds), ease: 'power1.in' });
  gsap.to(el, { autoAlpha: 0, duration: 0.4, delay: Math.max(0.3, seconds), ease: 'power2.out' });
}

/** The count-in number thumps on each beat. */
export function beatThump(el: HTMLElement): void {
  if (reduced()) return;
  gsap.fromTo(el, { scale: 1.25, autoAlpha: 0.6 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
}
