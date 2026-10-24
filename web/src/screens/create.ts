import { PIECES } from '@kilukkam/shared';
import { instrumentMeta } from '../music.js';
import type { Screen, ScreenFactory } from '../ui.js';
import { h, hint, topBar } from '../ui.js';

export const createScreen: ScreenFactory = (s, a) => {
  const cards = PIECES.map((p) =>
    h(
      'button',
      { class: 'card piece-card', 'data-piece': p.id, onclick: () => a.createRoom(p.id) },
      h('div', { class: 'piece-head' },
        h('h2', {}, p.title),
        h('span', { class: 'muted' }, `${p.composer} · ${p.bpm} bpm`),
      ),
      h(
        'ul',
        { class: 'instrument-list' },
        ...p.tracks.map((t) => {
          const m = instrumentMeta(t.instrument);
          return h(
            'li',
            { style: `--tint: ${m.color}` },
            h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, m.emoji),
            h('span', { class: 'grow' }, t.name),
            h('span', { class: 'muted' }, `up to ${t.maxPlayers}`),
          );
        }),
      ),
      h('span', { class: 'card-cta' }, 'Conduct this piece →'),
    ),
  );

  const el = h(
    'main',
    { class: 'screen create' },
    topBar(undefined, () => a.goHome()),
    h('h1', { class: 'title' }, 'Pick a piece'),
    hint('You get a 4-letter code. Friends join with it and each picks an instrument.'),
    h('div', { class: 'stack' }, ...cards),
  );

  const update: Screen['update'] = (st) => {
    const busy = st.intent?.kind === 'create' ? st.intent.pieceId : null;
    for (const c of cards) {
      c.disabled = busy !== null;
      c.classList.toggle('busy', c.dataset.piece === busy);
    }
  };
  update(s);
  return { el, update };
};
