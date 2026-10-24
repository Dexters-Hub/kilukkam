import type { Screen, ScreenFactory } from '../ui/dom.js';
import { avatar, h, hint, replace, topBar } from '../ui/dom.js';
import { codeBlock } from './lobby.js';

export const endedScreen: ScreenFactory = (s, a) => {
  const body = h('div', { class: 'stack center' });
  const el = h(
    'main',
    { class: 'screen ended' },
    topBar(h('button', { class: 'btn btn-ghost', onclick: () => a.leave() }, 'Leave')),
    body,
  );

  const update: Screen['update'] = (st) => {
    const conductor = st.session?.role === 'conductor';
    const players = st.snapshot?.players.filter((p) => !p.conductor) ?? [];
    replace(
      body,
      h('div', { class: 'bravo', 'aria-hidden': 'true' }, '👏'),
      h('h1', { class: 'title' }, 'Well played'),
      h('p', { class: 'lede' }, st.piece ? `${st.piece.title} · ${players.length} ${players.length === 1 ? 'player' : 'players'}` : ''),
      st.runNotes ? h('p', { class: 'room-stat' }, `The room played ${st.runNotes.toLocaleString()} ${st.runNotes === 1 ? 'note' : 'notes'} together`) : null,
      h('div', { class: 'avatars' }, ...players.slice(0, 60).map((p) => avatar(p.avatar, { name: p.name, away: !p.connected }))),
      conductor
        ? h('button', { class: 'btn btn-primary btn-xl', disabled: players.length < 1, onclick: () => a.startPiece() }, 'Encore: play it again')
        : hint('Stay on this screen. The conductor may call an encore.'),
      st.snapshot ? codeBlock(st.snapshot.code, conductor) : null,
    );
  };
  update(s);
  return { el, update };
};
