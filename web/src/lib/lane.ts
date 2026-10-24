import type { ScoreEvent } from '@kilukkam/shared';
import type { ServerClock } from './clock.js';
import { hitName } from './music.js';
import { onsets, type BeatGrid, type Judgement } from './rhythm.js';

// The note lane: your upcoming notes glide down a highway to a glowing hit
// ring in time with the room's shared beat grid. The whole surface breathes
// on every beat, hits burst into particles, rests count you back in. Canvas
// 2D on its own rAF loop, so it never waits on the UI framework or the network.

export interface LaneOptions {
  events: readonly ScoreEvent[];
  grid: BeatGrid;
  clock: ServerClock;
  /** CSS colour of this phone's instrument */
  tint: string;
  /** The instrument, so drum hits read Kick and Snare instead of pitch names */
  instrument?: string;
  /** Brand highlight, flashed on a perfect hit */
  accent?: string;
  /** Beats per bar, so beat 1 of each bar pulses harder */
  beatsPerBar?: number;
  /** Beats of lane visible above the hit ring */
  lookahead?: number;
  /** Two hands: the lane of every event (null for rests). Leave out for the single centre lane. */
  sides?: readonly (LaneSide | null)[];
  /** Two hands: label the rings with key caps (F, J) instead of L and R */
  keys?: boolean;
}

/** Where a note falls in two-hands play: one lane, or a chord across both */
export type LaneSide = 'left' | 'right' | 'both';

/** Where the last tap landed, for two-hands play */
export interface FlashAt {
  /** The lane hit (or missed) */
  lane: LaneSide;
  /** The tap hit the wrong lane */
  wrong?: boolean;
}

export interface Lane {
  /** Index of the next note this phone will play */
  setCursor(index: number): void;
  /** The conductor muted this section: keep the pulse, quiet the notes */
  setResting(on: boolean): void;
  /** Show how the last tap landed; null for a played note with no timing (unsynced, loop) */
  flash(j: Judgement | null, at?: FlashAt): void;
  destroy(): void;
}

// ---------- pure helpers (tested in node) ----------

export interface Pulse {
  /** Whole beat we are in (negative during the count-in) */
  index: number;
  /** 0 at the beat, rising to 1 just before the next */
  phase: number;
  /** 1 on the beat, decaying fast towards 0 */
  strength: number;
  /** Beat 1 of the bar */
  downbeat: boolean;
}

export const beatPulse = (beat: number, beatsPerBar = 4): Pulse => {
  const index = Math.floor(beat);
  const phase = beat - index;
  const bar = Math.max(1, Math.round(beatsPerBar));
  return { index, phase, strength: Math.exp(-phase * 5), downbeat: ((index % bar) + bar) % bar === 0 };
};

/** A real rest is at least this many beats of silence before your next note */
export const REST_MIN_BEATS = 4;

/**
 * Beats to count down before this part's next note ("Your part comes in 3"),
 * or null when there is no rest to wait out: mid phrase, past the end, or
 * before the room's first downbeat (the count-in speaks then).
 */
export const restCountdown = (events: readonly ScoreEvent[], starts: readonly number[], cursor: number, beat: number): number | null => {
  if (beat < 0) return null;
  let next = Math.max(0, cursor);
  while (next < events.length && events[next]?.kind !== 'note') next++;
  if (next >= events.length) return null;
  let prev = next - 1;
  while (prev >= 0 && events[prev]?.kind !== 'note') prev--;
  const prevEvent = prev >= 0 ? events[prev] : undefined;
  const silenceFrom = prevEvent ? (starts[prev] ?? 0) + prevEvent.beats : 0;
  const at = starts[next] ?? 0;
  if (at - silenceFrom < REST_MIN_BEATS) return null;
  const until = at - beat;
  return until > 0.25 ? Math.ceil(until - 1e-6) : null;
};

/** Spring from 0 that overshoots and settles at 1; `t` in seconds */
export const spring = (t: number): number => (t <= 0 ? 0 : 1 - Math.exp(-t * 9) * Math.cos(t * 24));

/** `#rgb` or `#rrggbb` with alpha; anything else passes through opaque */
export const withAlpha = (color: string, a: number): string => {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
};

// ---------- renderer ----------

const LABEL: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const WRONG_SIDE = 'Wrong side';
const BURST: Record<Judgement, number> = { perfect: 30, great: 22, good: 14, miss: 0 };
const GREY = '#8d8a96';
const FONT = '"Inter Variable", system-ui, sans-serif';
const MAX_DPR = 2;
const MAX_PARTICLES = 96;
const WORD_MS = 720;
const SHOCK_MS = 460;
const SHAKE_MS = 340;
const FLASH_MS = 240;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
}

interface Shock {
  x: number;
  at: number;
  color: string;
  strong: boolean;
}

/** A soft round glow, drawn once and stamped wherever light is needed */
const glowSprite = (color: string, size = 128): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(color, 0.9));
    grad.addColorStop(0.35, withAlpha(color, 0.35));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
};

export const createLane = (canvas: HTMLCanvasElement, opts: LaneOptions): Lane => {
  const ctx = canvas.getContext('2d');
  const beats = onsets(opts.events);
  const lookahead = opts.lookahead ?? 4;
  const perBar = opts.beatsPerBar ?? 4;
  const tint = opts.tint;
  const accent = opts.accent || '#b6f400';
  const glow = glowSprite(tint);
  const spark = glowSprite('#ffffff', 32);
  const accentGlow = glowSprite(accent, 32);
  const tintSpark = glowSprite(tint, 32);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  const onMotion = () => {
    reduced = motion.matches;
  };
  motion.addEventListener('change', onMotion);

  let cursor = 0;
  let resting = false;
  let word: { text: string; color: string; at: number } | null = null;
  let shakeAt = -Infinity;
  /** Which lane shakes after a miss; 'both' shakes every ring */
  let shakeLane: LaneSide = 'both';
  let perfectAt = -Infinity;
  const shocks: Shock[] = [];
  const particles: Particle[] = [];
  let last = performance.now();
  let raf = 0;
  let w = 0;
  let h = 0;

  const resize = () => {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /** Hit ring geometry: the lane covers the whole surface, the ring sits above the big note name */
  const sides = opts.sides;
  const layout = () => {
    const hitY = Math.min(h * 0.66, h - 285);
    const topY = Math.max(72, h * 0.09);
    // Two hands: each lane sits a hand's width either side of centre, with its own ring.
    const split = sides ? Math.min(w * 0.24, 118) : 0;
    return {
      cx: w / 2,
      hitY,
      topY,
      perBeat: (hitY - topY) / lookahead,
      ringR: sides ? Math.min(40, w * 0.1) : Math.min(46, w * 0.12),
      laneHalf: sides ? split * 0.62 : Math.min(w * 0.34, 170),
      split,
    };
  };
  /** Lanes drawn: -1 left, 1 right, or just the centre */
  const signs: readonly number[] = sides ? [-1, 1] : [0];
  const signOf = (lane: LaneSide): number[] => (!sides || lane === 'both' ? [...signs] : [lane === 'left' ? -1 : 1]);

  const ringPath = (x: number, y: number, r: number) => {
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  };

  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!ctx || document.hidden || !w || !h) return;
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const beat = opts.grid.beatAt(opts.clock.now());
    const pulse = beatPulse(beat, perBar);
    const { cx, hitY, topY, perBeat, ringR, laneHalf, split } = layout();
    const kick = pulse.strength * (pulse.downbeat ? 1 : 0.55);
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Room pulse: a tint glow from the hit zone that swells on every beat.
    const glowR = Math.max(w, h) * (reduced ? 0.85 : 0.8 + kick * 0.12);
    ctx.globalAlpha = (reduced ? 0.22 + kick * 0.1 : 0.2 + kick * 0.3) * (resting ? 0.6 : 1);
    ctx.drawImage(glow, cx - glowR, hitY - glowR, glowR * 2, glowR * 2);

    // 2. Beat rings rolling out of the hit zone, bolder on beat 1.
    if (!reduced) {
      for (let k = pulse.index; k >= pulse.index - 1; k--) {
        const age = beat - k;
        const span = 1.6;
        if (age < 0 || age > span) continue;
        const p = age / span;
        const down = beatPulse(k, perBar).downbeat;
        const ease = 1 - (1 - p) ** 3;
        ctx.globalAlpha = (1 - p) ** 2 * (down ? 0.55 : 0.25);
        ctx.strokeStyle = tint;
        ctx.lineWidth = (down ? 3.5 : 1.5) * (1 - p) + 0.5;
        ringPath(cx, hitY, ringR + ease * Math.max(w, h) * (down ? 0.75 : 0.55));
        ctx.stroke();
      }
    }

    // 3. The highway: two rails per lane converging towards the top, a rung every beat.
    const depth = (y: number) => 1 - 0.55 * Math.min(1, Math.max(0, (hitY - y) / (hitY - topY)));
    const laneX = (sign: number, y: number) => cx + sign * split * depth(y);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    for (const sign of signs) {
      for (const rail of [-1, 1]) {
        ctx.moveTo(laneX(sign, hitY + ringR) + rail * laneHalf, hitY + ringR);
        ctx.lineTo(laneX(sign, topY) + rail * laneHalf * depth(topY), topY);
      }
    }
    ctx.stroke();
    ctx.fillStyle = tint;
    for (let b = Math.ceil(beat); b < beat + lookahead + 1; b++) {
      const y = hitY - (b - beat) * perBeat;
      if (y < topY) break;
      const half = laneHalf * depth(y);
      const fade = Math.min(1, (y - topY) / (perBeat * 0.8));
      ctx.globalAlpha = (beatPulse(b, perBar).downbeat ? 0.26 : 0.09) * fade;
      for (const sign of signs) ctx.fillRect(laneX(sign, y) - half, y - 0.5, half * 2, 1);
    }

    // 4. Upcoming notes as glowing gems in their lane, swelling as they near the ring; held notes
    //    trail a tail, chords span both lanes with a bar between their gems.
    for (let i = cursor; i < opts.events.length; i++) {
      const e = opts.events[i];
      const d = (beats[i] ?? 0) - beat;
      if (d > lookahead + 0.1) break;
      if (!e || e.kind !== 'note') continue;
      const y = hitY - d * perBeat;
      const z = Math.min(1, Math.max(0, d / lookahead));
      const r = ringR * (0.72 - 0.34 * z) * (i === cursor ? 1.08 : 1);
      const fadeIn = Math.min(1, (lookahead + 0.1 - d) / 0.6);
      const near = Math.max(0, 1 - Math.abs(d) * 1.5);
      const alpha = fadeIn * (i === cursor ? 1 : 0.72) * (resting ? 0.3 : 1);
      const xs = signOf(sides?.[i] ?? 'both').map((sign) => laneX(sign, y));
      if (xs.length > 1) {
        const [x0, x1] = [xs[0] as number, xs[xs.length - 1] as number];
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, withAlpha(tint, 0.85));
        grad.addColorStop(0.5, withAlpha('#ffffff', 0.7));
        grad.addColorStop(1, withAlpha(tint, 0.85));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x0, y - r * 0.24, x1 - x0, r * 0.48, r * 0.24);
        ctx.fill();
      }
      for (const x of xs) {
        if (e.beats >= 1.5) {
          const tailTop = Math.max(topY, y - e.beats * perBeat + r);
          if (tailTop < y) {
            const grad = ctx.createLinearGradient(0, y, 0, tailTop);
            grad.addColorStop(0, withAlpha(tint, 0.75));
            grad.addColorStop(1, withAlpha(tint, 0.05));
            ctx.globalAlpha = alpha;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(x - r * 0.42, tailTop, r * 0.84, y - tailTop, r * 0.42);
            ctx.fill();
          }
        }
        const halo = r * (3.2 + near * 1.4);
        ctx.globalAlpha = alpha * (0.55 + near * 0.45);
        ctx.drawImage(glow, x - halo, y - halo, halo * 2, halo * 2);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = tint;
        ringPath(x, y, r);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillStyle = '#fff';
        ringPath(x - r * 0.28, y - r * 0.3, r * 0.36);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${Math.round(r * 0.7)}px ${FONT}`;
        ctx.fillText(hitName(opts.instrument ?? '', e.midi), x, y + 1);
      }
    }

    // 5. The hit rings, pulsing with the beat; grey and shaking for a moment after a miss.
    const shook = t - shakeAt;
    const missing = shook < SHAKE_MS;
    const lit = t - perfectAt < FLASH_MS * 1.6;
    const shake = missing && !reduced ? Math.sin(shook * 0.09) * 8 * Math.exp(-shook / 90) : 0;
    const rr = ringR * (reduced ? 1 : 1 + kick * 0.1);
    const ringAlpha = reduced ? 0.6 + kick * 0.3 : 0.85;
    const shaking = signOf(shakeLane);
    for (const sign of signs) {
      const hurt = missing && shaking.includes(sign);
      const ringColor = hurt ? GREY : lit ? accent : tint;
      const x = laneX(sign, hitY) + (hurt ? shake : 0);
      ctx.strokeStyle = ringColor;
      ctx.globalAlpha = (hurt ? 0.06 : 0.12 + kick * 0.12) * (resting ? 0.6 : 1);
      ctx.fillStyle = ringColor;
      ringPath(x, hitY, rr);
      ctx.fill();
      for (const [width, a] of [
        [16, 0.07],
        [8, 0.16],
        [3, ringAlpha],
      ] as const) {
        ctx.lineWidth = width;
        ctx.globalAlpha = a * (resting ? 0.6 : 1);
        ringPath(x, hitY, rr);
        ctx.stroke();
      }
      // A quiet hint under each ring: the key caps on a laptop, L and R on a phone.
      if (sign) {
        const label = opts.keys ? (sign < 0 ? 'F' : 'J') : sign < 0 ? 'L' : 'R';
        const capY = hitY + ringR + 24;
        ctx.globalAlpha = 0.32 * (resting ? 0.6 : 1);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x - 13, capY - 13, 26, 26, opts.keys ? 6 : 13);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 13px ${FONT}`;
        ctx.fillText(label, x, capY + 1);
      }
    }

    // 6. Shockwaves from hits.
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i] as Shock;
      const p = (t - s.at) / SHOCK_MS;
      if (p >= 1) {
        shocks.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - p) ** 3;
      ctx.globalAlpha = (1 - p) * (s.strong ? 1 : 0.8);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.strong ? 9 : 6) * (1 - p) + 0.5;
      ringPath(s.x, hitY, ringR + ease * ringR * (s.strong ? 3.2 : 2.4));
      ctx.stroke();
    }

    // 7. Particles, added light on dark.
    if (particles.length) {
      ctx.globalCompositeOperation = 'lighter';
      const drag = Math.pow(0.04, dt);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i] as Particle;
        const age = (t - p.born) / p.life;
        if (age >= 1) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= drag;
        p.vy = p.vy * drag + 420 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const size = p.size * (1 - age * 0.6) * 3;
        ctx.globalAlpha = 1 - age * age;
        ctx.drawImage(p.color === 'accent' ? accentGlow : p.color === 'white' ? spark : tintSpark, p.x - size, p.y - size, size * 2, size * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 8. A lime flash across the surface on a perfect hit.
    const flashed = t - perfectAt;
    if (flashed < FLASH_MS) {
      ctx.globalAlpha = (reduced ? 0.1 : 0.2) * (1 - flashed / FLASH_MS);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, w, h);
    }

    // 9. The grade word springs out above the ring and drifts up.
    if (word) {
      const age = t - word.at;
      if (age >= WORD_MS) word = null;
      else {
        const scale = reduced ? 1 : spring(age / 1000);
        const fade = Math.min(1, (WORD_MS - age) / 260);
        const quiet = word.text === LABEL.miss || word.text === WRONG_SIDE;
        const size = Math.round(Math.min(w * 0.11, 46) * (quiet ? 0.8 : 1));
        ctx.save();
        ctx.translate(cx, hitY - ringR - 46 - (reduced ? 0 : age * 0.03));
        ctx.scale(scale, scale);
        ctx.globalAlpha = fade;
        ctx.font = `900 ${size}px ${FONT}`;
        if (!quiet) {
          ctx.shadowColor = word.color;
          ctx.shadowBlur = 22;
        }
        ctx.fillStyle = word.color;
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }
    }

    // 10. Count-in before beat 0: each number lands on its beat.
    if (beat < 0 && beat > -4.5) {
      const size = Math.round(Math.min(w, h) * 0.32 * (reduced ? 1 : 1 + pulse.strength * 0.14));
      ctx.fillStyle = tint;
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.globalAlpha = 0.25 + 0.75 * (1 - pulse.phase);
      ctx.fillText(String(Math.ceil(-beat)), cx, h * 0.36);
    }

    // 11. A calm countdown through a rest, so the phone says when you're back in.
    const count = resting ? null : restCountdown(opts.events, beats, cursor, beat);
    if (count !== null) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(Math.min(w * 0.05, 20))}px ${FONT}`;
      ctx.fillText('Your part comes in', cx, h * 0.27);
      const near = count <= 4;
      const size = Math.round(Math.min(w, h) * (near ? 0.26 : 0.2) * (reduced ? 1 : 1 + pulse.strength * 0.08));
      ctx.globalAlpha = reduced ? 0.65 + pulse.strength * 0.3 : 0.75 + pulse.strength * 0.25;
      ctx.fillStyle = near ? tint : '#fff';
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.fillText(String(count), cx, h * 0.37);
    }
    ctx.globalAlpha = 1;
  };
  raf = requestAnimationFrame(draw);

  const burst = (j: Judgement | null, lane: LaneSide) => {
    const { cx, hitY, ringR, split } = layout();
    const t = performance.now();
    const strong = j === 'perfect';
    const xs = signOf(lane).map((sign) => cx + sign * split);
    for (const x of xs) shocks.push({ x, at: t, color: strong ? accent : tint, strong });
    while (shocks.length > 4) shocks.shift();
    if (reduced) return;
    const n = Math.round((j ? BURST[j] : 12) / xs.length);
    for (const x of xs) {
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        // Mostly upward, like sparks thrown off the ring.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
        const speed = 180 + Math.random() * (strong ? 460 : 340);
        const color = strong && i % 3 === 0 ? 'accent' : i % 5 === 0 ? 'white' : 'tint';
        particles.push({
          x: x + Math.cos(angle) * ringR * 0.8,
          y: hitY + Math.sin(angle) * ringR * 0.8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: t,
          life: 420 + Math.random() * 380,
          size: 2 + Math.random() * 3,
          color,
        });
      }
    }
  };

  return {
    setCursor: (index) => {
      cursor = index;
    },
    setResting: (on) => {
      resting = on;
    },
    flash: (j, at) => {
      const t = performance.now();
      if (j === 'miss') {
        shakeAt = t;
        shakeLane = at?.lane ?? 'both';
        word = { text: at?.wrong ? WRONG_SIDE : LABEL.miss, color: GREY, at: t };
        return;
      }
      burst(j, at?.lane ?? 'both');
      if (!j) return;
      if (j === 'perfect') perfectAt = t;
      word = { text: LABEL[j], color: j === 'perfect' ? accent : j === 'great' ? tint : '#ffffff', at: t };
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      motion.removeEventListener('change', onMotion);
    },
  };
};
