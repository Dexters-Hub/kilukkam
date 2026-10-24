import type { ScoreEvent } from '@kilukkam/shared';
import type { ServerClock } from './clock.js';
import { hitName } from './music.js';
import { onsets, type BeatGrid, type Judgement } from './rhythm.js';

// The note lane, played like piano tiles: flat columns fill the surface and
// every note falls as a tile in its column, as tall as the note is long, in
// time with the room's shared beat grid. Tap a tile as its bottom edge reaches
// the hit zone; played tiles go grey, missed ones flash red. The surface
// breathes on every beat, hits throw sparks, rests count you back in. Canvas
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
  /** Beats of tiles visible above the hit zone */
  lookahead?: number;
  /** Column play: the column of every event (null for rests). Leave out for one centre column. */
  lanes?: readonly (number | null)[];
  /** Column play: how many columns fill the surface */
  laneCount?: number;
  /** Key caps to print under each column (laptops) */
  keys?: readonly string[];
  /** Expert: events that are hold tiles */
  holds?: readonly boolean[];
  /** Expert: events that are flick tiles */
  flicks?: readonly boolean[];
}

/** Where the last tap landed */
export interface FlashAt {
  /** The column hit (or missed); leave out for every column */
  lane?: number;
  /** The tap hit the wrong column */
  wrong?: boolean;
  /** Word to pop instead of the grade, such as "Let go early" */
  text?: string;
}

export interface Lane {
  /** Index of the next note this phone will play */
  setCursor(index: number): void;
  /** The conductor muted this section: keep the pulse, quiet the tiles */
  setResting(on: boolean): void;
  /** Show how the last tap landed; null for a played note with no timing (unsynced, loop) */
  flash(j: Judgement | null, at?: FlashAt): void;
  /** The tile at `index` was played: it flashes, then goes grey */
  played(index: number): void;
  /** The player's streak, which brightens the disco lights */
  setCombo(n: number): void;
  /** A finger or key came down on a column: light it */
  press(lane: number): void;
  /** ...and lifted */
  release(lane: number): void;
  /** The hold tile at `index` was hit and is being held */
  hold(index: number): void;
  /** The held tile was let go before its end */
  letGo(): void;
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

const parseHex = (color: string): number | null => {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return /^[0-9a-f]{6}$/i.test(full) ? parseInt(full, 16) : null;
};

/** `#rgb` or `#rrggbb` with alpha; anything else passes through opaque */
export const withAlpha = (color: string, a: number): string => {
  const n = parseHex(color);
  if (n === null) return color;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
};

/** A hex colour mixed towards white (`amount` > 0) or black (< 0), as `#rrggbb`; anything else passes through */
export const shade = (color: string, amount: number): string => {
  const n = parseHex(color);
  if (n === null) return color;
  const a = Math.max(-1, Math.min(1, amount));
  const mix = (c: number) => Math.round(a >= 0 ? c + (255 - c) * a : c * (1 + a));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix) as [number, number, number];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

/** Shades of the instrument colour per lane, alternating light and dark so neighbours read apart */
export const laneTints = (tint: string, count: number): string[] => {
  const steps = count >= 4 ? [0.42, -0.2, 0.16, -0.36] : count === 2 ? [0.3, -0.22] : [0];
  return Array.from({ length: Math.max(1, count) }, (_, i) => shade(tint, steps[i % steps.length] ?? 0));
};

// ---------- renderer ----------

const LABEL: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const WRONG_LANE = 'Wrong column';
const BURST: Record<Judgement, number> = { perfect: 30, great: 22, good: 14, miss: 0 };
const GREY = '#8d8a96';
const RED = '#ff3b4f';
const FONT = '"Inter Variable", system-ui, sans-serif';
const MAX_DPR = 2;
const MAX_PARTICLES = 96;
const WORD_MS = 720;
const SHOCK_MS = 420;
const FLASH_MS = 240;
/** Column glow fade after a finger lifts */
const PRESS_FADE_MS = 180;
/** A missed tile flashes red this long, then stays a dim red */
const MISS_FLASH_MS = 420;
/** A dropped hold greys out over this long */
const DROP_MS = 320;
/** Gap between consecutive tiles in a column, CSS px */
const TILE_GAP = 3;

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

/** Party lights the disco sweeps add to the instrument colour and the brand accent */
const DISCO = ['#7b5cff', '#2fd3ff'];
/** A tile's played flash and the light beam it throws up its column */
const TILE_FLASH_MS = 260;
const BEAM_MS = 520;
const MAX_BEAMS = 6;

/** A light cone pointing up from its apex at the bottom centre, drawn once and rotated */
const coneSprite = (color: string): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 512, 0, 0);
    grad.addColorStop(0, withAlpha(color, 0.9));
    grad.addColorStop(0.5, withAlpha(color, 0.3));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(80, 512);
    g.lineTo(0, 0);
    g.lineTo(160, 0);
    g.closePath();
    g.fill();
  }
  return c;
};

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
  const lanes = opts.lanes;
  const count = lanes ? Math.max(1, opts.laneCount ?? 2) : 1;
  const tints = laneTints(tint, count);
  const glow = glowSprite(tint);
  const spark = glowSprite('#ffffff', 32);
  const accentGlow = glowSprite(accent, 32);
  const tintSpark = glowSprite(tint, 32);
  const lights = [tint, accent, ...DISCO];
  const cones = lights.map(coneSprite);
  const spots = lights.map((c) => glowSprite(c, 96));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  const onMotion = () => {
    reduced = motion.matches;
  };
  motion.addEventListener('change', onMotion);

  let cursor = 0;
  let resting = false;
  let word: { text: string; color: string; at: number } | null = null;
  let perfectAt = -Infinity;
  const shocks: Shock[] = [];
  const particles: Particle[] = [];
  /** Tiles played, and when each missed tile was first seen missed */
  const hit = new Set<number>();
  const missedAt = new Map<number, number>();
  /** First tile that may still be on screen */
  let first = 0;
  /** Per column: held down now, when it last lifted, and a red flash after a wrong tap */
  const down: boolean[] = Array.from({ length: count }, () => false);
  const liftedAt: number[] = Array.from({ length: count }, () => -Infinity);
  const wrongAt: number[] = Array.from({ length: count }, () => -Infinity);
  /** When each tile was played (for its flash), and the beams thrown up the columns */
  const playedAt = new Map<number, number>();
  const beams: { lane: number; at: number; strong: boolean }[] = [];
  /** The player's current streak: the disco gets brighter with it */
  let combo = 0;
  /** The hold being held, or one just dropped (greying out) */
  let held: { index: number; dropped: number | null } | null = null;
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

  /** Columns fill the surface; one column (Easy) sits in the middle. The hit zone sits above the big note name. */
  const layout = () => {
    const hitY = Math.min(h * 0.7, h - 250);
    const topY = Math.max(64, h * 0.08);
    const colW = count === 1 ? Math.min(w * 0.5, 220) : w / count;
    return { cx: w / 2, hitY, topY, perBeat: (hitY - topY) / lookahead, colW, left: count === 1 ? (w - colW) / 2 : 0 };
  };

  /** An upward chevron centred on x, y */
  const chevron = (x: number, y: number, size: number) => {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.5);
    ctx.lineTo(x, y - size * 0.5);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.stroke();
  };

  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!ctx || document.hidden || !w || !h) return;
    const t = performance.now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const beat = opts.grid.beatAt(opts.clock.now());
    const pulse = beatPulse(beat, perBar);
    const { cx, hitY, topY, perBeat, colW, left } = layout();
    const kick = pulse.strength * (pulse.downbeat ? 1 : 0.55);
    const quiet = resting ? 0.6 : 1;
    const colX = (i: number) => left + i * colW;
    const glowOf = (i: number) => (down[i] ? 1 : Math.max(0, 1 - (t - (liftedAt[i] ?? -Infinity)) / PRESS_FADE_MS));
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Room pulse: a tint glow from the hit zone that swells on every beat.
    const glowR = Math.max(w, h) * (reduced ? 0.85 : 0.8 + kick * 0.12);
    ctx.globalAlpha = (reduced ? 0.2 + kick * 0.08 : 0.16 + kick * 0.26) * quiet;
    ctx.drawImage(glow, cx - glowR, hitY - glowR, glowR * 2, glowR * 2);

    // 1b. Disco: slow coloured sweeps from the floor and spotlights pulsing on the beat, brighter
    //     as the streak grows. Reduced motion keeps the room still.
    if (!reduced) {
      const heat = Math.min(1, combo / 40);
      const secs = t / 1000;
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < cones.length; k++) {
        const cone = cones[k] as HTMLCanvasElement;
        const fromLeft = k % 2 === 0;
        const ax = fromLeft ? w * (0.08 + 0.1 * k) : w * (0.92 - 0.1 * k);
        const sway = Math.sin(secs * (0.32 + k * 0.07) + k * 1.9) * 0.55;
        ctx.save();
        ctx.translate(ax, h + 20);
        ctx.rotate((fromLeft ? 0.28 : -0.28) + sway);
        ctx.globalAlpha = (0.05 + heat * 0.1 + kick * (0.05 + heat * 0.08)) * quiet;
        ctx.drawImage(cone, -w * 0.32, -h * 1.25, w * 0.64, h * 1.25);
        ctx.restore();
      }
      for (let k = 0; k < spots.length; k++) {
        const spot = spots[k] as HTMLCanvasElement;
        const sx = w * (0.5 + 0.4 * Math.sin(secs * (0.21 + k * 0.05) + k * 2.3));
        const sy = h * (0.3 + 0.22 * Math.cos(secs * (0.17 + k * 0.04) + k));
        const r = Math.min(w, h) * (0.28 + kick * 0.1 + heat * 0.06);
        ctx.globalAlpha = (0.04 + heat * 0.07 + kick * (0.06 + heat * 0.1)) * quiet;
        ctx.drawImage(spot, sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 2. The columns: a faint floor per column that lights while pressed or flashes red after a
    //    wrong tap, thin dividers between them, and a faint rule on every beat.
    for (let i = 0; i < count; i++) {
      const lit = glowOf(i);
      const wrong = Math.max(0, 1 - (t - (wrongAt[i] ?? -Infinity)) / MISS_FLASH_MS);
      ctx.globalAlpha = (0.05 + lit * 0.14) * quiet;
      ctx.fillStyle = tints[i] ?? tint;
      ctx.fillRect(colX(i), 0, colW, h);
      if (wrong > 0) {
        ctx.globalAlpha = wrong * 0.28;
        ctx.fillStyle = RED;
        ctx.fillRect(colX(i), 0, colW, h);
      }
    }
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i <= count; i++) {
      if (count > 1 && (i === 0 || i === count)) continue;
      ctx.globalAlpha = 0.16 * quiet;
      ctx.fillRect(Math.round(colX(i)) - 0.5, 0, 1, h);
    }
    for (let b = Math.ceil(beat - (h - hitY) / perBeat); b < beat + hitY / perBeat + 1; b++) {
      const y = hitY - (b - beat) * perBeat;
      if (y < 0 || y > h) continue;
      ctx.globalAlpha = (beatPulse(b, perBar).downbeat ? 0.12 : 0.045) * quiet;
      ctx.fillRect(left, y - 0.5, colW * count, 1);
    }

    // 3. The hit zone: a band across the columns at the bottom, breathing with the beat.
    const zone = ctx.createLinearGradient(0, hitY - 26, 0, hitY + 26);
    zone.addColorStop(0, withAlpha(tint, 0));
    zone.addColorStop(0.5, withAlpha(perfectAt > t - FLASH_MS * 1.6 ? accent : tint, (reduced ? 0.3 : 0.24 + kick * 0.2) * quiet));
    zone.addColorStop(1, withAlpha(tint, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = zone;
    ctx.fillRect(left, hitY - 26, colW * count, 52);
    ctx.globalAlpha = (0.35 + kick * 0.25) * quiet;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, hitY - 0.75, colW * count, 1.5);

    // 4. The tiles. Upcoming ones in their column's shade, as tall as the note; played ones grey and
    //    dim; missed ones flash red. A held hold fills bright from its bottom as it plays.
    while (first < cursor && first < opts.events.length) {
      const top = hitY - ((beats[first] ?? 0) + (opts.events[first]?.beats ?? 0) - beat) * perBeat;
      if (top < h) break;
      first++;
    }
    // Tiles enter below the header, never under it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topY, w, h - topY);
    ctx.clip();
    for (let i = first; i < opts.events.length; i++) {
      const e = opts.events[i];
      const d = (beats[i] ?? 0) - beat;
      const bottom = hitY - d * perBeat;
      if (bottom < topY - 4) break;
      if (!e || e.kind !== 'note') continue;
      const tileH = Math.max(18, e.beats * perBeat - TILE_GAP);
      const top = bottom - tileH;
      if (top > h) continue;
      const lane = lanes?.[i] ?? 0;
      const x = colX(lane) + 2;
      const tw = colW - 4;
      const color = tints[lane] ?? tint;
      const isHold = !!opts.holds?.[i];
      const isHeld = held?.index === i;
      const radius = Math.min(10, tw / 6);
      const done = i < cursor;
      const wasHit = hit.has(i);
      if (done && !wasHit && !isHeld && !missedAt.has(i)) missedAt.set(i, t);
      const missAge = missedAt.has(i) ? t - (missedAt.get(i) ?? t) : null;
      const fadeIn = Math.min(1, Math.max(0, (bottom - topY) / 60));
      let fill = color;
      let alpha = (i === cursor ? 1 : 0.88) * fadeIn * (resting ? 0.3 : 1);
      if (isHeld && held?.dropped !== null) {
        fill = GREY;
        alpha *= Math.max(0.25, 1 - (t - (held?.dropped ?? t)) / DROP_MS);
      } else if (done && wasHit && !isHeld) {
        fill = GREY;
        alpha *= 0.32;
      } else if (missAge !== null) {
        const flash = Math.max(0, 1 - missAge / MISS_FLASH_MS);
        fill = RED;
        alpha *= 0.35 + flash * 0.6 * (reduced ? 0.6 : 1);
      }
      // Near the zone the next tile glows, so the eye knows what to hit.
      if (!done && d < 1) {
        const near = Math.max(0, 1 - Math.abs(d));
        ctx.globalAlpha = near * 0.55 * alpha;
        const g = tw * 0.9;
        ctx.drawImage(glow, x + tw / 2 - g, bottom - g * 0.5, g * 2, g);
      }
      // Glass: a translucent body in the tile's shade, a soft inner glow, a sheen across the top
      // and a bright rim. A tile just played flashes bright.
      const flashAge = playedAt.has(i) ? t - (playedAt.get(i) ?? t) : Infinity;
      const flash = Math.max(0, 1 - flashAge / TILE_FLASH_MS) * (reduced ? 0.5 : 1);
      const body = ctx.createLinearGradient(0, top, 0, bottom);
      body.addColorStop(0, withAlpha(fill, 0.55));
      body.addColorStop(1, withAlpha(fill, 0.35));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(x, top, tw, tileH, radius);
      ctx.fill();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 7;
      ctx.globalAlpha = alpha * 0.22;
      ctx.beginPath();
      ctx.roundRect(x + 3.5, top + 3.5, tw - 7, Math.max(0, tileH - 7), Math.max(0, radius - 3));
      ctx.stroke();
      const sheenH = Math.min(tileH * 0.45, 46);
      const sheen = ctx.createLinearGradient(0, top, 0, top + sheenH);
      sheen.addColorStop(0, withAlpha('#ffffff', 0.38));
      sheen.addColorStop(1, withAlpha('#ffffff', 0));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.roundRect(x + 1, top + 1, tw - 2, sheenH, [radius, radius, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = shade(fill, 0.55);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.roundRect(x + 0.75, top + 0.75, tw - 1.5, tileH - 1.5, radius);
      ctx.stroke();
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, top, tw, tileH, radius);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      if (isHold) {
        // A hold carries a bright spine; held, the part that crossed the zone glows white.
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillRect(x + tw / 2 - 1.5, top + 10, 3, Math.max(0, tileH - 34));
        if (isHeld && held?.dropped === null) {
          const filled = Math.min(tileH, Math.max(0, bottom - hitY));
          const body = ctx.createLinearGradient(0, bottom, 0, bottom - filled);
          body.addColorStop(0, withAlpha('#ffffff', 0.85));
          body.addColorStop(1, withAlpha(color, 0.9));
          ctx.globalAlpha = 1;
          ctx.fillStyle = body;
          ctx.beginPath();
          ctx.roundRect(x, bottom - filled, tw, filled, radius);
          ctx.fill();
          ctx.globalCompositeOperation = 'lighter';
          const g = tw * (reduced ? 0.8 : 0.8 + kick * 0.3);
          ctx.globalAlpha = 0.7;
          ctx.drawImage(glow, x + tw / 2 - g, hitY - g * 0.6, g * 2, g * 1.2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.globalAlpha = alpha;
      if (opts.flicks?.[i] && !done) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const a = Math.min(14, tw * 0.16);
        const my = top + tileH / 2;
        chevron(x + tw / 2, my - a * 0.55, a);
        chevron(x + tw / 2, my + a * 0.55, a);
      } else if (tw > 30) {
        // Crisp white name with a small shadow, so it reads on any shade.
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = done ? alpha * 0.7 : Math.min(1, alpha * 1.1);
        ctx.font = `800 ${Math.round(Math.min(16, tw * 0.2))}px ${FONT}`;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.fillText(hitName(opts.instrument ?? '', e.midi), x + tw / 2, bottom - Math.min(14, tileH / 2));
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      }
    }

    ctx.restore();

    // 5. The hold being held ends: sparks when it reaches its end, nothing more when dropped.
    if (held) {
      const e = opts.events[held.index];
      const end = (beats[held.index] ?? 0) + (e?.beats ?? 0);
      const dropAge = held.dropped === null ? 0 : t - held.dropped;
      if (!e || end <= beat || dropAge > DROP_MS) {
        if (e && held.dropped === null) burst('great', lanes?.[held.index] ?? 0);
        held = null;
      }
    }

    // 6. Key caps under the zone on a laptop.
    if (opts.keys) {
      ctx.font = `700 13px ${FONT}`;
      for (let i = 0; i < count; i++) {
        const label = opts.keys[i];
        if (!label) continue;
        const x = colX(i) + colW / 2;
        const capY = hitY + 40;
        ctx.globalAlpha = (0.32 + glowOf(i) * 0.5) * quiet;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x - 13, capY - 13, 26, 26, 6);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x, capY + 1);
      }
    }

    // 6b. Light beams thrown up the column of every hit.
    if (beams.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i] as (typeof beams)[number];
        const p = (t - b.at) / BEAM_MS;
        if (p >= 1) {
          beams.splice(i, 1);
          continue;
        }
        const x = colX(b.lane);
        const reach = hitY - (hitY - topY) * (0.35 + 0.65 * (1 - (1 - p) ** 3));
        const beam = ctx.createLinearGradient(0, hitY, 0, reach);
        const color = b.strong ? accent : (tints[b.lane] ?? tint);
        beam.addColorStop(0, withAlpha('#ffffff', 0.7));
        beam.addColorStop(0.2, withAlpha(color, 0.55));
        beam.addColorStop(1, withAlpha(color, 0));
        ctx.globalAlpha = (1 - p) * quiet;
        ctx.fillStyle = beam;
        const inset = colW * 0.18 * p;
        ctx.fillRect(x + inset, reach, colW - inset * 2, hitY - reach);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 7. Hit flares: a frame that swells out of the column that was hit.
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i] as Shock;
      const p = (t - s.at) / SHOCK_MS;
      if (p >= 1) {
        shocks.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - p) ** 3;
      const hw = colW / 2 - 2 + ease * (s.strong ? 18 : 10);
      const hh = 10 + ease * (s.strong ? 46 : 30);
      ctx.globalAlpha = (1 - p) * (s.strong ? 1 : 0.8);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.strong ? 6 : 4) * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.roundRect(s.x - hw, hitY - hh, hw * 2, hh * 2, 12);
      ctx.stroke();
    }

    // 8. Particles, added light on dark.
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

    // 9. A lime flash across the surface on a perfect hit.
    const flashed = t - perfectAt;
    if (flashed < FLASH_MS) {
      ctx.globalAlpha = (reduced ? 0.08 : 0.16) * (1 - flashed / FLASH_MS);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, w, h);
    }

    // 10. The grade word springs out above the zone and drifts up.
    if (word) {
      const age = t - word.at;
      if (age >= WORD_MS) word = null;
      else {
        const scale = reduced ? 1 : spring(age / 1000);
        const fade = Math.min(1, (WORD_MS - age) / 260);
        const soft = word.color === GREY;
        const size = Math.round(Math.min(w * 0.11, 46) * (soft ? 0.8 : 1));
        ctx.save();
        ctx.translate(cx, hitY - 96 - (reduced ? 0 : age * 0.03));
        ctx.scale(scale, scale);
        ctx.globalAlpha = fade;
        ctx.font = `900 ${size}px ${FONT}`;
        if (!soft) {
          ctx.shadowColor = word.color;
          ctx.shadowBlur = 22;
        }
        ctx.fillStyle = word.color;
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }
    }

    // 11. Count-in before beat 0: each number lands on its beat.
    if (beat < 0 && beat > -4.5) {
      const size = Math.round(Math.min(w, h) * 0.32 * (reduced ? 1 : 1 + pulse.strength * 0.14));
      ctx.fillStyle = tint;
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.globalAlpha = 0.25 + 0.75 * (1 - pulse.phase);
      ctx.fillText(String(Math.ceil(-beat)), cx, h * 0.36);
    }

    // 12. A calm countdown through a rest, so the phone says when you're back in.
    const countdown = resting ? null : restCountdown(opts.events, beats, cursor, beat);
    if (countdown !== null) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(Math.min(w * 0.05, 20))}px ${FONT}`;
      ctx.fillText('Your part comes in', cx, h * 0.27);
      const soon = countdown <= 4;
      const size = Math.round(Math.min(w, h) * (soon ? 0.26 : 0.2) * (reduced ? 1 : 1 + pulse.strength * 0.08));
      ctx.globalAlpha = reduced ? 0.65 + pulse.strength * 0.3 : 0.75 + pulse.strength * 0.25;
      ctx.fillStyle = soon ? tint : '#fff';
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.fillText(String(countdown), cx, h * 0.37);
    }
    ctx.globalAlpha = 1;
  };

  /** A flare and sparks thrown off the hit zone of column `lane` (null: every column) */
  function burst(j: Judgement | null, lane: number | null) {
    const { hitY, colW, left } = layout();
    const t = performance.now();
    const strong = j === 'perfect';
    const xs = (lane === null ? tints.map((_, i) => i) : [lane]).map((i) => left + (i + 0.5) * colW);
    for (const x of xs) shocks.push({ x, at: t, color: strong ? accent : tint, strong });
    while (shocks.length > 4) shocks.shift();
    if (reduced) return;
    for (const i of lane === null ? tints.map((_, k) => k) : [lane]) beams.push({ lane: i, at: t, strong });
    while (beams.length > MAX_BEAMS) beams.shift();
    const n = Math.round((j ? BURST[j] : 12) / xs.length);
    for (const x of xs) {
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        // Mostly upward, like sparks thrown off the key.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
        const speed = 180 + Math.random() * (strong ? 460 : 340);
        const color = strong && i % 3 === 0 ? 'accent' : i % 5 === 0 ? 'white' : 'tint';
        particles.push({
          x: x + (Math.random() - 0.5) * colW * 0.8,
          y: hitY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: t,
          life: 420 + Math.random() * 380,
          size: 2 + Math.random() * 3,
          color,
        });
      }
    }
  }

  raf = requestAnimationFrame(draw);
  const inRange = (lane: number) => lane >= 0 && lane < count;

  return {
    setCursor: (index) => {
      if (index < cursor) {
        // A fresh start or rewind: forget what was played.
        hit.clear();
        missedAt.clear();
        playedAt.clear();
        first = 0;
      }
      cursor = index;
    },
    setResting: (on) => {
      resting = on;
    },
    flash: (j, at) => {
      const t = performance.now();
      if (j === 'miss') {
        if (at?.lane !== undefined && inRange(at.lane)) wrongAt[at.lane] = t;
        word = { text: at?.text ?? (at?.wrong ? WRONG_LANE : LABEL.miss), color: GREY, at: t };
        return;
      }
      burst(j, at?.lane ?? null);
      if (!j) return;
      if (j === 'perfect') perfectAt = t;
      word = { text: at?.text ?? LABEL[j], color: j === 'perfect' ? accent : j === 'great' ? tint : '#ffffff', at: t };
    },
    played: (index) => {
      hit.add(index);
      playedAt.set(index, performance.now());
      if (playedAt.size > 32) playedAt.delete(playedAt.keys().next().value as number);
    },
    setCombo: (n) => {
      combo = n;
    },
    press: (lane) => {
      if (inRange(lane)) down[lane] = true;
    },
    release: (lane) => {
      if (!inRange(lane)) return;
      down[lane] = false;
      liftedAt[lane] = performance.now();
    },
    hold: (index) => {
      held = { index, dropped: null };
    },
    letGo: () => {
      if (held && held.dropped === null) held.dropped = performance.now();
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      motion.removeEventListener('change', onMotion);
    },
  };
};
