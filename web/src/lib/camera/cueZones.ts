import { CONDUCTOR, isPointing, sideFor, type CueSide } from './conductor.js';
import type { HandFrame } from './features.js';

// Where each section sits in the camera picture, always on screen: the
// frame is split into thirds, each labelled with the section it cues in its
// own colour. Pointing into a third lights it and fills a ring at your
// fingertip; when the ring closes the cue fires (the conductor's own hold
// time), so you can see the gesture landing before it happens.

export interface Zone {
  side: CueSide;
  label: string;
  color: string;
}

export interface ZoneState {
  side: CueSide | null;
  since: number;
}

export const newZoneState = (): ZoneState => ({ side: null, since: 0 });

const SIDES: readonly CueSide[] = ['left', 'center', 'right'];

export function drawCueZones(c: CanvasRenderingContext2D, w: number, h: number, zones: readonly Zone[], frame: HandFrame, st: ZoneState, flash: { side: CueSide; t: number } | null): void {
  const now = frame.t;
  const pointer = frame.hands.find(isPointing);
  if (pointer) {
    const side = sideFor(pointer.indexTip.x, st.side);
    if (side !== st.side) {
      st.side = side;
      st.since = now;
    }
  } else st.side = null;
  const hold = st.side ? Math.min(1, (now - st.since) / CONDUCTOR.cueHoldMs) : 0;
  const font = (px: number) => `800 ${px}px "Inter Variable", system-ui, sans-serif`;
  const px = Math.max(12, Math.round(h * 0.034));

  SIDES.forEach((side, i) => {
    const zone = zones.find((z) => z.side === side);
    if (!zone) return;
    const x0 = (i * w) / 3;
    const active = st.side === side;
    const fired = flash?.side === side && now - flash.t < 800;
    if (active || fired) {
      c.fillStyle = zone.color;
      c.globalAlpha = fired ? 0.3 * (1 - (now - (flash?.t ?? now)) / 800) + 0.08 : 0.1 + 0.14 * hold;
      c.fillRect(x0, 0, w / 3, h);
      c.globalAlpha = 1;
    }
    if (i) {
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.setLineDash([4, 8]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x0, 0);
      c.lineTo(x0, h);
      c.stroke();
      c.setLineDash([]);
    }
    // The section's name tag at the top of its third.
    c.font = font(px);
    const text = zone.label;
    const tw = c.measureText(text).width;
    const cx = x0 + w / 6;
    const ty = h * 0.075;
    c.fillStyle = active || fired ? zone.color : 'rgba(10,10,10,0.55)';
    c.beginPath();
    c.roundRect(cx - tw / 2 - px * 0.8, ty - px * 0.85, tw + px * 1.6, px * 1.7, px * 0.85);
    c.fill();
    c.strokeStyle = zone.color;
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, cx, ty + 1);
  });

  // The hold ring at the fingertip, in the colour of the section about to come in.
  if (pointer && st.side) {
    const zone = zones.find((z) => z.side === st.side);
    const x = pointer.indexTip.x * w;
    const y = pointer.indexTip.y * h;
    const r = Math.max(16, h * 0.045);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = zone?.color ?? '#b6f400';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + hold * Math.PI * 2);
    c.stroke();
    c.font = font(Math.round(px * 0.85));
    c.fillStyle = '#ffffff';
    c.fillText(hold >= 1 ? `${zone?.label ?? ''} in` : 'Hold…', x, y - r - px);
  }
  c.textBaseline = 'alphabetic';
}
