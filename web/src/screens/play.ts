import { bump, coachIn, coachOut, dud, noteHit } from '../lib/anim.js';
import { createLane, type Lane } from '../lib/lane.js';
import { instrumentMeta, noteName } from '../lib/music.js';
import { myTrack, nextEvents, playersByTrack, progress, pulseBumps, type AppState } from '../lib/store.js';
import type { EnsemblePulse, ScreenFactory } from '../ui/dom.js';
import { avatar, h, readPref, replace, writePref } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const COACHED_PREF = 'kilukkam.coached';
/** Dots shown per instrument in the room strip before collapsing into "+n" */
const ROOM_DOTS_PER_ROW = 12;
/** Most dots one row bumps per pulse, however hard that section is tapping */
const ROOM_BUMPS_PER_ROW = 4;

/** A quiet strip of everyone else in the room, one row per instrument; dots bump on ensemble_pulse. */
const roomView = () => {
  const el = h('div', { class: 'room-view', 'aria-hidden': 'true' });
  const dotFor = new Map<string, HTMLElement>();
  const shownByTrack = new Map<string, string[]>();
  let roster = '';

  const update = (st: AppState) => {
    const players = st.snapshot?.players ?? [];
    const next = `${st.piece?.id ?? ''}|${players.map((p) => `${p.id}:${p.trackId ?? ''}:${p.connected}`).join('|')}`;
    if (next === roster) return;
    roster = next;
    dotFor.clear();
    shownByTrack.clear();
    const groups = playersByTrack(players);
    replace(
      el,
      ...(st.piece?.tracks ?? []).map((t) => {
        const ps = groups.get(t.id) ?? [];
        const visible = ps.slice(0, ROOM_DOTS_PER_ROW);
        shownByTrack.set(t.id, visible.map((p) => p.id));
        const extra = ps.length - visible.length;
        const meta = instrumentMeta(t.instrument);
        const row = h(
          'div',
          { class: 'room-row' },
          h('span', { class: 'room-row-label' }, icon(t.instrument, 14)),
          ...visible.map((p) => {
            const dot = avatar(p.avatar, { size: 'xs', mine: p.id === st.playerId, away: !p.connected });
            dotFor.set(p.id, dot);
            return dot;
          }),
          extra > 0 ? h('span', { class: 'room-more' }, `+${extra}`) : null,
        );
        row.style.setProperty('--tint', meta.color);
        return row;
      }),
    );
  };

  const pulse = (p: EnsemblePulse) => {
    for (const id of pulseBumps(p.counts, shownByTrack, ROOM_BUMPS_PER_ROW)) {
      const dot = dotFor.get(id);
      if (dot) bump(dot);
    }
  };

  return { el, update, pulse };
};

/** Keep the screen awake while playing; best effort, not all browsers have it. */
export function holdWakeLock(): () => void {
  let lock: WakeLockSentinel | null = null;
  let released = false;
  const request = () => {
    if (released || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(
      (l) => {
        if (released) void l.release();
        else lock = l;
      },
      () => {},
    );
  };
  document.addEventListener('visibilitychange', request);
  request();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', request);
    void lock?.release();
  };
}

export const playScreen: ScreenFactory = (s, a) => {
  const room = roomView();
  const who = h('div', { class: 'play-who' });
  const combo = h('div', { class: 'play-combo', 'aria-live': 'polite' });
  const assist = h('button', { class: 'play-assist', type: 'button', 'aria-pressed': 'true' }, icon('magic-wand', 18), 'Assist');
  const canvas = h('canvas', { class: 'note-lane', 'aria-hidden': 'true' });
  const now = h('div', { class: 'play-now', 'aria-live': 'polite' });
  const bar = h('div', { class: 'progress-fill' });
  const glow = h('div', { class: 'tap-glow', 'aria-hidden': 'true' });
  const idle = h('p', { class: 'play-idle' });

  const surface = h('button', { class: 'tap-surface', 'aria-label': 'Play your next note' }, glow, canvas, now, idle);
  const el = h(
    'main',
    { class: 'screen play' },
    h('div', { class: 'progress', 'aria-hidden': 'true' }, bar),
    h('header', { class: 'play-bar' }, who, combo, assist),
    surface,
    room.el,
  );

  let lane: Lane | null = null;
  let laneKey = '';
  const ensureLane = (st: AppState) => {
    const track = myTrack(st);
    const rhythm = a.rhythm();
    const key = track && rhythm ? `${st.piece?.id}/${track.id}/${st.snapshot?.startedAt}` : '';
    if (key === laneKey) return;
    lane?.destroy();
    lane = null;
    laneKey = key;
    if (track && rhythm) {
      // Resolve the instrument's colour token from the theme: the screen may not be attached yet.
      const tint = getComputedStyle(document.documentElement).getPropertyValue(`--${track.instrument}`).trim() || '#ff5b1f';
      lane = createLane(canvas, { events: track.events, grid: rhythm.grid, clock: rhythm.clock, tint });
    }
  };

  // First-timers get one pulsing nudge; the first tap (which also plays) retires it.
  let coach: HTMLElement | null = null;
  let coached = readPref(COACHED_PREF) !== null;
  const showCoach = () => {
    coach = h('div', { class: 'coach', role: 'status' }, h('span', { class: 'coach-ring', 'aria-hidden': 'true' }), 'Tap when your note reaches the line');
    surface.append(coach);
    coachIn(coach);
  };
  const dismissCoach = () => {
    if (!coach) return;
    coachOut(coach);
    coach = null;
    coached = true;
    writePref(COACHED_PREF, '1');
  };

  // pointerdown, not click: fires on touch start so the note sounds at once,
  // and preventDefault stops double-tap zoom and ghost clicks.
  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissCoach();
    const result = a.tap();
    if (!result.played) {
      dud(now);
      return;
    }
    noteHit(now, glow);
    if (result.judgement) lane?.flash(result.judgement);
  });
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  assist.addEventListener('click', () => a.setAssist(assist.getAttribute('aria-pressed') !== 'true'));

  const update = (st: AppState) => {
    room.update(st);
    const track = myTrack(st);
    replace(who, st.session ? avatar(st.session.avatar, { name: st.session.name, size: 'sm' }) : null, h('span', {}, st.session?.name ?? ''));
    assist.setAttribute('aria-pressed', String(st.assist));
    const t = st.tally;
    replace(combo, t.combo >= 3 ? h('strong', {}, `${t.combo}×`) : null, t.notes ? h('span', {}, `${Math.round(t.accuracy)}%`) : null);

    if (!track) {
      el.style.removeProperty('--tint');
      replace(now, '');
      replace(idle, 'Pick an instrument in the lobby to join the next run.');
      bar.style.width = '0%';
      lane?.destroy();
      lane = null;
      laneKey = '';
      return;
    }
    const meta = instrumentMeta(track.instrument);
    el.style.setProperty('--tint', meta.color);
    ensureLane(st);
    lane?.setCursor(st.cursor);
    const [cur] = nextEvents(track.events, st.cursor, 1);
    bar.style.width = `${progress(track.events, st.cursor) * 100}%`;
    replace(now, cur ? noteName(cur.note.midi) : '');
    replace(idle, cur ? '' : 'You’ve played every note. Listen to the room finish!');
    surface.classList.toggle('done', !cur);
    if (!coached && !coach && cur) showCoach();
  };

  update(s);
  const release = holdWakeLock();
  return {
    el,
    update,
    pulse: room.pulse,
    destroy: () => {
      release();
      lane?.destroy();
      if (coach) coachOut(coach);
    },
  };
};
