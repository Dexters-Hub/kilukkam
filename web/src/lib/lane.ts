import type { ScoreEvent } from '@kilukkam/shared';
import type { ServerClock } from './clock.js';
import { noteName } from './music.js';
import { onsets, type BeatGrid, type Judgement } from './rhythm.js';

// The note lane: your upcoming notes glide down to a hit line in time with
// the room's shared beat grid, like cue cards for a section. Canvas 2D on its
// own rAF loop, so it never waits on the UI framework or the network.

export interface LaneOptions {
  events: readonly ScoreEvent[];
  grid: BeatGrid;
  clock: ServerClock;
  /** CSS colour of this phone's instrument */
  tint: string;
  /** Beats of lane visible above the hit line */
  lookahead?: number;
}

export interface Lane {
  /** Index of the next note this phone will play */
  setCursor(index: number): void;
  /** Show how the last tap landed */
  flash(j: Judgement): void;
  destroy(): void;
}

const LABEL: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const HIT_Y = 0.78;
const MAX_DPR = 2;

export const createLane = (canvas: HTMLCanvasElement, opts: LaneOptions): Lane => {
  const ctx = canvas.getContext('2d');
  const beats = onsets(opts.events);
  const lookahead = opts.lookahead ?? 4;
  let cursor = 0;
  let flashAt = -Infinity;
  let flashText = '';
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

  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!ctx || document.hidden) return;
    const now = opts.clock.now();
    const beat = opts.grid.beatAt(now);
    const hitY = h * HIT_Y;
    const perBeat = hitY / lookahead;
    ctx.clearRect(0, 0, w, h);

    // Beat rails: a faint line every beat, a stronger one on each bar.
    for (let b = Math.ceil(beat - 1); b < beat + lookahead + 1; b++) {
      const y = hitY - (b - beat) * perBeat;
      ctx.globalAlpha = b % 4 === 0 ? 0.22 : 0.08;
      ctx.fillStyle = opts.tint;
      ctx.fillRect(w * 0.18, y - 0.5, w * 0.64, 1);
    }
    ctx.globalAlpha = 1;

    // The hit line, breathing on the beat.
    const pulse = 1 - (((beat % 1) + 1) % 1);
    ctx.fillStyle = opts.tint;
    ctx.globalAlpha = 0.35 + pulse * 0.45;
    ctx.fillRect(w * 0.12, hitY - 2, w * 0.76, 4);
    ctx.globalAlpha = 1;

    // Upcoming notes from the cursor on.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = cursor; i < opts.events.length; i++) {
      const e = opts.events[i];
      const b = beats[i] ?? 0;
      if (b - beat > lookahead) break;
      if (!e || e.kind !== 'note') continue;
      const y = hitY - (b - beat) * perBeat;
      const len = Math.max(10, e.beats * perBeat - 8);
      const r = Math.min(30, w * 0.08);
      ctx.globalAlpha = i === cursor ? 1 : 0.55;
      ctx.fillStyle = opts.tint;
      ctx.beginPath();
      ctx.roundRect(w / 2 - r, y - len, r * 2, len, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(r * 0.62)}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillText(noteName(e.midi), w / 2, y - Math.min(len, r));
    }

    // Count-in before beat 0.
    if (beat < 0 && beat > -4.5) {
      ctx.fillStyle = opts.tint;
      ctx.font = `800 ${Math.round(Math.min(w, h) * 0.32)}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.globalAlpha = 0.25 + 0.75 * (1 - ((beat % 1) + 1) % 1);
      ctx.fillText(String(Math.ceil(-beat)), w / 2, h * 0.36);
      ctx.globalAlpha = 1;
    }

    // Judgement for the last tap.
    const since = now - flashAt;
    if (since < 650) {
      ctx.globalAlpha = 1 - since / 650;
      ctx.fillStyle = flashText === LABEL.miss ? '#9c99aa' : opts.tint;
      ctx.font = `800 ${Math.round(w * 0.09)}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillText(flashText, w / 2, hitY + 44 - since * 0.03);
      ctx.globalAlpha = 1;
    }
  };
  raf = requestAnimationFrame(draw);

  return {
    setCursor: (index) => {
      cursor = index;
    },
    flash: (j) => {
      flashText = LABEL[j];
      flashAt = opts.clock.now();
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
};
