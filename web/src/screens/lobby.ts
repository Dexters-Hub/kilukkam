import { PIECES, type PlayerSnapshot, type Track } from '@kilukkam/shared';
import { instrumentMeta, noteName } from '../lib/music.js';
import { me, myTrack, nextEvents, playersByTrack, type AppState } from '../lib/store.js';
import { popInNew } from '../lib/anim.js';
import type { Actions, Screen, ScreenFactory } from '../ui/dom.js';
import { avatar, cx, h, hint, replace, topBar } from '../ui/dom.js';

export function codeBlock(code: string, conductor: boolean): HTMLElement {
  return h(
    'section',
    { class: 'code-block' },
    h('span', { class: 'label' }, conductor ? 'Room code' : 'You are in room'),
    h('div', { class: 'room-code', 'aria-label': `Room code ${[...code].join(' ')}` }, code),
    conductor ? h('p', { class: 'muted' }, `Friends open ${location.host} and type this code.`) : null,
  );
}

function avatars(players: readonly PlayerSnapshot[], myId: string | null): HTMLElement {
  return h(
    'div',
    { class: 'avatars' },
    ...players.map((p) => avatar(p.avatar, { name: p.name, pid: p.id, size: 'sm', mine: p.id === myId, away: !p.connected })),
  );
}

function trackCard(t: Track, players: readonly PlayerSnapshot[], s: AppState, a: Actions): HTMLElement {
  const m = instrumentMeta(t.instrument);
  const mine = me(s)?.trackId === t.id;
  const full = players.length >= t.maxPlayers;
  return h(
    'button',
    {
      class: cx('card', 'instrument-card', mine && 'mine'),
      style: `--tint: ${m.color}`,
      disabled: full && !mine,
      'aria-pressed': String(mine),
      onclick: () => {
        if (!mine) a.pickTrack(t.id);
      },
    },
    h('span', { class: 'instrument-emoji', 'aria-hidden': 'true' }, m.emoji),
    h(
      'span',
      { class: 'grow' },
      h('strong', {}, t.name),
      h('span', { class: 'muted block' }, mine ? 'Your instrument' : full ? 'Full' : t.name === m.label ? 'Tap to play this' : m.label),
    ),
    h('span', { class: 'count' }, `${players.length}/${t.maxPlayers}`),
    players.length ? avatars(players, s.playerId) : null,
  );
}

export const lobbyScreen: ScreenFactory = (s, a) => {
  const body = h('div', { class: 'stack' });
  const el = h(
    'main',
    { class: 'screen lobby' },
    topBar(h('button', { class: 'btn btn-ghost', onclick: () => a.leave() }, 'Leave')),
    body,
  );

  // Kicking is two taps: × arms it for 3 s, a second tap confirms.
  let armed: string | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let last = s;
  const seen = new Set<string>();

  const kickBtn = (p: PlayerSnapshot) =>
    h(
      'button',
      {
        class: cx('kick', armed === p.id && 'armed'),
        'aria-label': armed === p.id ? `Confirm remove ${p.name}` : `Remove ${p.name}`,
        onclick: () => {
          if (armed === p.id) {
            armed = null;
            a.kick(p.id);
          } else {
            armed = p.id;
            if (armTimer) clearTimeout(armTimer);
            armTimer = setTimeout(() => {
              armed = null;
              update(last);
            }, 3000);
          }
          update(last);
        },
      },
      armed === p.id ? 'Kick?' : '×',
    );

  const roster = (title: string, players: readonly PlayerSnapshot[], tint: string, capacity: string) =>
    h(
      'section',
      { class: 'roster', style: `--tint: ${tint}` },
      h('div', { class: 'roster-head' }, h('strong', {}, title), h('span', { class: 'count' }, capacity)),
      players.length
        ? h(
            'ul',
            { class: 'roster-list' },
            ...players.map((p) =>
              h(
                'li',
                { class: cx(!p.connected && 'away'), 'data-pid': p.id },
                avatar(p.avatar, { name: p.name, away: !p.connected }),
                h('span', { class: 'grow name' }, p.name),
                kickBtn(p),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nobody yet'),
    );

  const conductorView = (st: AppState) => {
    const snap = st.snapshot;
    const piece = st.piece;
    if (!snap || !piece) return [];
    const groups = playersByTrack(snap.players);
    const count = snap.players.filter((p) => !p.conductor).length;
    const unassigned = groups.get(null) ?? [];
    return [
      codeBlock(snap.code, true),
      hint('Share the code. Players pick an instrument, then you start the piece.'),
      h(
        'div',
        { class: 'segmented', role: 'radiogroup', 'aria-label': 'Piece' },
        ...PIECES.map((p) =>
          h(
            'button',
            {
              class: p.id === piece.id ? 'on' : '',
              role: 'radio',
              'aria-checked': String(p.id === piece.id),
              onclick: () => {
                if (p.id !== piece.id) a.setPiece(p.id);
              },
            },
            h('strong', {}, p.title),
            h('span', { class: 'muted block small' }, p.composer),
          ),
        ),
      ),
      h('p', { class: 'muted' }, `${count} of ${snap.maxPlayers} players`),
      ...piece.tracks.map((t) => {
        const m = instrumentMeta(t.instrument);
        const ps = groups.get(t.id) ?? [];
        return roster(`${m.emoji} ${t.name}`, ps, m.color, `${ps.length}/${t.maxPlayers}`);
      }),
      unassigned.length ? roster('Still choosing', unassigned, 'var(--muted)', String(unassigned.length)) : null,
      h(
        'div',
        { class: 'dock' },
        h('button', { class: 'btn btn-primary btn-xl', disabled: count < 1, onclick: () => a.startPiece() }, count < 1 ? 'Waiting for players…' : 'Start the piece'),
      ),
    ];
  };

  const playerView = (st: AppState) => {
    const snap = st.snapshot;
    const piece = st.piece;
    if (!snap || !piece) return [];
    const groups = playersByTrack(snap.players);
    const mine = me(st)?.trackId ?? null;
    const first = nextEvents(myTrack(st)?.events ?? [], 0, 1)[0];
    return [
      codeBlock(snap.code, false),
      h(
        'div',
        { class: 'piece-line' },
        h('strong', {}, piece.title),
        h('span', { class: 'muted' }, ` · ${piece.composer}`),
      ),
      h('h2', { class: 'subtitle' }, mine ? 'Waiting for the conductor to start…' : 'Pick your instrument'),
      first
        ? hint(`You’re set. Your first note is ${noteName(first.note.midi)}${first.restBefore > 0 ? ` after ${first.restBefore} beats of rest` : ''}.`)
        : hint('Tap an instrument to play it, or let us choose for you.'),
      ...piece.tracks.map((t) => trackCard(t, groups.get(t.id) ?? [], st, a)),
      h('div', { class: 'dock' }, h('button', { class: 'btn btn-xl', onclick: () => a.autoAssign() }, mine ? 'Shuffle me' : '✨ Surprise me')),
    ];
  };

  const update: Screen['update'] = (st) => {
    last = st;
    replace(body, ...(st.session?.role === 'conductor' ? conductorView(st) : playerView(st)));
    popInNew(body, seen);
  };
  update(s);
  return {
    el,
    update,
    destroy: () => {
      if (armTimer) clearTimeout(armTimer);
    },
  };
};
