import { instrumentMeta } from '../music.js';
import { playersByTrack, type AppState } from '../store.js';
import { bump, burst, lanePulse, popInNew } from '../anim.js';
import type { NoteEcho, ScreenFactory } from '../ui.js';
import { avatar, h, replace } from '../ui.js';
import { holdWakeLock } from './play.js';

// Conductor's view while playing: one lane per instrument. Every note_echo
// bumps the player's avatar and throws a ripple across the lane.

interface Lane {
  el: HTMLElement;
  field: HTMLElement;
  dots: HTMLElement;
  fill: HTMLElement;
  tally: HTMLElement;
  length: number;
  furthest: number;
  notes: number;
}

export const stageScreen: ScreenFactory = (s, a) => {
  const lanes = new Map<string, Lane>();
  const dotFor = new Map<string, HTMLElement>();
  const lanesEl = h('div', { class: 'lanes' });
  const title = h('span', { class: 'stage-title' });
  const total = h('span', { class: 'count' }, '0 notes');
  let notes = 0;
  const seen = new Set<string>();

  const el = h(
    'main',
    { class: 'screen stage' },
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), title),
      total,
    ),
    lanesEl,
    h('div', { class: 'dock' }, h('button', { class: 'btn btn-xl btn-stop', onclick: () => a.stopPiece() }, '■ Stop the piece')),
  );

  const build = (st: AppState) => {
    const piece = st.piece;
    lanes.clear();
    if (!piece) return;
    title.textContent = piece.title;
    replace(
      lanesEl,
      ...piece.tracks.map((t) => {
        const m = instrumentMeta(t.instrument);
        const field = h('div', { class: 'lane-field' });
        const dots = h('div', { class: 'lane-dots' });
        const fill = h('div', { class: 'progress-fill' });
        const tally = h('span', { class: 'count' });
        const lane: Lane = {
          el: h(
            'section',
            { class: 'lane', style: `--tint: ${m.color}` },
            h('div', { class: 'lane-head' }, h('strong', {}, `${m.emoji} ${t.name}`), tally),
            field,
            dots,
            h('div', { class: 'progress thin' }, fill),
          ),
          field,
          dots,
          fill,
          tally,
          length: t.events.length,
          furthest: 0,
          notes: 0,
        };
        lanes.set(t.id, lane);
        return lane.el;
      }),
    );
  };

  const update = (st: AppState) => {
    if (lanes.size === 0 || st.piece?.tracks.some((t) => !lanes.has(t.id))) build(st);
    const groups = playersByTrack(st.snapshot?.players ?? []);
    dotFor.clear();
    for (const [trackId, lane] of lanes) {
      const ps = groups.get(trackId) ?? [];
      replace(
        lane.dots,
        ...ps.map((p) => {
          const d = avatar(p.avatar, { name: p.name, pid: p.id, size: 'sm', away: !p.connected });
          dotFor.set(p.id, d);
          return d;
        }),
      );
      lane.tally.textContent = `${ps.length} playing`;
    }
    popInNew(lanesEl, seen);
  };

  const echo = (e: NoteEcho) => {
    const lane = lanes.get(e.trackId);
    if (!lane) return;
    notes++;
    lane.notes++;
    total.textContent = `${notes} ${notes === 1 ? 'note' : 'notes'}`;
    lane.furthest = Math.max(lane.furthest, e.noteIndex + 1);
    lane.fill.style.width = `${Math.min(100, (lane.furthest / Math.max(1, lane.length)) * 100)}%`;
    lanePulse(lane.el);
    const dot = dotFor.get(e.playerId);
    if (dot) bump(dot);
    burst(lane.field);
  };

  update(s);
  const release = holdWakeLock();
  return { el, update, echo, destroy: release };
};
