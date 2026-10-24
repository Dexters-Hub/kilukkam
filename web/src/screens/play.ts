import { bump, coachIn, coachOut, dud, noteHit } from '../lib/anim.js';
import { instrumentMeta, noteName } from '../lib/music.js';
import { myTrack, nextEvents, playersByTrack, progress, pulseBumps, skipRests, type AppState } from '../lib/store.js';
import type { EnsemblePulse, ScreenFactory } from '../ui/dom.js';
import { avatar, h, readPref, replace, writePref } from '../ui/dom.js';

const COACHED_PREF = 'kilukkam.coached';
/** Dots shown per instrument in the room view before collapsing into "+n" */
const ROOM_DOTS_PER_ROW = 14;
/** Most dots one row bumps per pulse, however hard that section is tapping */
const ROOM_BUMPS_PER_ROW = 4;

/**
 * A quiet strip of everyone else in the room, one row per instrument.
 * Dots bump on ensemble_pulse so you feel the ensemble around you.
 */
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
        const shown = visible.map((p) => {
          const dot = avatar(p.avatar, { size: 'xs', mine: p.id === st.playerId, away: !p.connected });
          dotFor.set(p.id, dot);
          return dot;
        });
        const extra = ps.length - shown.length;
        return h(
          'div',
          { class: 'room-row', style: `--tint: ${instrumentMeta(t.instrument).color}` },
          h('span', { class: 'room-row-label' }, instrumentMeta(t.instrument).emoji),
          ...shown,
          extra > 0 ? h('span', { class: 'room-more' }, `+${extra}`) : null,
        );
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

function beatsLabel(beats: number): string {
  if (beats % 4 === 0) return beats === 4 ? '1 bar' : `${beats / 4} bars`;
  return beats === 1 ? '1 beat' : `${beats} beats`;
}

export const playScreen: ScreenFactory = (s, a) => {
  const room = roomView();
  const who = h('div', { class: 'play-who' });
  const instrument = h('div', { class: 'play-inst' });
  const cue = h('div', { class: 'play-cue' });
  const now = h('div', { class: 'play-now' });
  const upcoming = h('div', { class: 'play-next' });
  const bar = h('div', { class: 'progress-fill' });
  const hint = h('div', { class: 'play-hint' });

  const glow = h('div', { class: 'tap-glow', 'aria-hidden': 'true' });
  const surface = h(
    'button',
    { class: 'tap-surface', 'aria-label': 'Play next note' },
    glow,
    who,
    instrument,
    cue,
    now,
    upcoming,
    hint,
    room.el,
  );
  // First-timers get one pulsing nudge; the first tap (which also plays) retires it for good.
  let coach: HTMLElement | null = null;
  let coached = readPref(COACHED_PREF) !== null;
  const showCoach = () => {
    coach = h('div', { class: 'coach', role: 'status' }, h('span', { class: 'coach-ring', 'aria-hidden': 'true' }), 'Tap anywhere to play your note');
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

  // pointerdown, not click: fires on touch start so the note sounds
  // immediately, and preventDefault stops double-tap zoom + ghost clicks.
  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismissCoach();
    if (a.tap()) noteHit(now, glow);
    else dud(now);
  });
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  const el = h(
    'main',
    { class: 'screen play' },
    h('div', { class: 'progress', 'aria-hidden': 'true' }, bar),
    surface,
  );

  const update = (st: AppState) => {
    room.update(st);
    const track = myTrack(st);
    replace(who, st.session ? avatar(st.session.avatar, { name: st.session.name }) : null, st.session?.name ?? '');
    if (!track) {
      el.style.removeProperty('--tint');
      replace(instrument, 'Piece in progress');
      replace(cue, '');
      replace(now, '🎧');
      replace(upcoming, '');
      replace(hint, 'You’ll get an instrument when the conductor calls an encore.');
      bar.style.width = '0%';
      return;
    }
    const m = instrumentMeta(track.instrument);
    el.style.setProperty('--tint', m.color);
    replace(instrument, `${m.emoji} ${track.name}`);
    const win = nextEvents(track.events, st.cursor, 3);
    const [cur, ...rest] = win;
    bar.style.width = `${progress(track.events, st.cursor) * 100}%`;
    if (!cur) {
      replace(cue, '');
      replace(now, 'Fine');
      replace(upcoming, '');
      replace(hint, 'You’ve played every note. Listen to the others finish!');
      surface.classList.add('done');
      return;
    }
    surface.classList.remove('done');
    replace(cue, cur.restBefore > 0 ? `Wait ${beatsLabel(cur.restBefore)}, then` : '');
    replace(now, noteName(cur.note.midi));
    replace(
      upcoming,
      ...rest.map((w) => h('span', { class: 'next-note' }, w.restBefore > 0 ? '· ' : '', noteName(w.note.midi))),
    );
    replace(hint, cur.index === skipRests(track.events, 0) ? 'Tap anywhere to play' : `Hold ${beatsLabel(cur.note.beats)}`);
    if (!coached && !coach) showCoach();
  };

  update(s);
  const release = holdWakeLock();
  return {
    el,
    update,
    pulse: room.pulse,
    destroy: () => {
      release();
      if (coach) coachOut(coach);
    },
  };
};
