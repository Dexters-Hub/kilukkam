import { CONDUCTOR_AVATAR } from '../composers.js';
import type { Screen, ScreenFactory } from '../ui.js';
import { avatar, h, replace, wordmark } from '../ui.js';

interface Step {
  title: string;
  body: string;
  visual: () => HTMLElement;
}

const STEPS: readonly Step[] = [
  {
    title: 'The conductor starts a room',
    body: 'They pick a piece and get a 4-letter code.',
    visual: () => avatar(CONDUCTOR_AVATAR),
  },
  {
    title: 'Friends join with the code',
    body: 'Open this page on your phone and type it in.',
    visual: () => h('span', { class: 'step-code' }, 'BACH'),
  },
  {
    title: 'Tap to play your notes',
    body: 'Pick an instrument. Each tap plays your next note.',
    visual: () => h('span', { class: 'step-tap' }),
  },
];

const HEADLINERS = ['bach', 'mozart', 'beethoven', 'chopin', 'rahman'] as const;

export const homeScreen: ScreenFactory = (s, a) => {
  const notice = h('p', { class: 'notice', role: 'status' });

  const el = h(
    'main',
    { class: 'screen home' },
    h(
      'section',
      { class: 'hero' },
      h('div', { class: 'hero-band', 'aria-hidden': 'true' }, ...HEADLINERS.map((id) => avatar(id, { size: 'lg' }))),
      h('h1', {}, wordmark('hero')),
      h('p', { class: 'promise' }, 'Turn a room full of phones into an orchestra.'),
    ),
    h(
      'ol',
      { class: 'steps', 'aria-label': 'How it works' },
      ...STEPS.map((step, i) =>
        h(
          'li',
          { class: 'step' },
          h('span', { class: 'step-num', 'aria-hidden': 'true' }, i + 1),
          h('span', { class: 'grow' }, h('strong', { class: 'block' }, step.title), h('span', { class: 'muted small' }, step.body)),
          h('span', { class: 'step-visual', 'aria-hidden': 'true' }, step.visual()),
        ),
      ),
    ),
    notice,
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-xl', onclick: () => a.goJoin() }, 'Join with a code'),
      h('button', { class: 'btn btn-xl', onclick: () => a.goCreate() }, 'Conduct a room'),
    ),
    h('p', { class: 'fine' }, 'Turn your ringer on and the volume up.'),
  );

  const update: Screen['update'] = (st) => {
    notice.hidden = !st.notice;
    replace(notice, st.notice ?? '');
  };
  update(s);
  return { el, update };
};
