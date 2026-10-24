import { CODE_LEN, MAX_NAME_LEN } from '@kilukkam/shared';
import { COMPOSERS, pickComposer } from '../data/composers.js';
import { isCompleteCode, normalizeCode, normalizeName } from '../lib/store.js';
import type { Screen, ScreenFactory } from '../ui/dom.js';
import { avatar, h, hint, readPref, replace, topBar, writePref } from '../ui/dom.js';

const AVATAR_PREF = 'kilukkam.avatar';
const NAME_PREF = 'kilukkam.name';

export const joinScreen: ScreenFactory = (s, a) => {
  let chosen = pickComposer(readPref(AVATAR_PREF)).id;

  const code = h('input', {
    class: 'code-input',
    id: 'code',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'next',
    maxlength: CODE_LEN + 2,
    placeholder: 'ABCD',
    'aria-describedby': 'code-hint',
  });
  code.value = normalizeCode(s.joinCode);

  const name = h('input', {
    class: 'field',
    id: 'name',
    autocomplete: 'nickname',
    enterkeyhint: 'go',
    maxlength: MAX_NAME_LEN,
    placeholder: 'Your name',
  });
  name.value = readPref(NAME_PREF) ?? '';

  const picks = COMPOSERS.map((c) =>
    h(
      'button',
      {
        class: 'lineup-btn',
        type: 'button',
        role: 'radio',
        'aria-label': c.fullName,
        'data-id': c.id,
        onclick: () => {
          chosen = c.id;
          paintPicks();
        },
      },
      avatar(c.id, { size: 'lg' }),
      h('span', { class: 'lineup-name', 'aria-hidden': 'true' }, c.displayName),
    ),
  );
  const paintPicks = () => {
    for (const b of picks) {
      const on = b.dataset.id === chosen;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  paintPicks();

  const go = h('button', { class: 'btn btn-primary btn-xl', type: 'submit' }, 'Join the ensemble');
  const notice = h('p', { class: 'notice', role: 'status' });

  const valid = () => isCompleteCode(code.value) && normalizeName(name.value).length > 0;
  const refresh = (busy: boolean) => {
    go.disabled = busy || !valid();
    go.textContent = busy ? 'Joining…' : 'Join the ensemble';
  };

  code.addEventListener('input', () => {
    const n = normalizeCode(code.value);
    if (n !== code.value) code.value = n;
    if (n.length === CODE_LEN && !name.value) name.focus();
    refresh(false);
  });
  name.addEventListener('input', () => refresh(false));

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!valid()) return;
        const n = normalizeName(name.value);
        writePref(NAME_PREF, n);
        writePref(AVATAR_PREF, chosen);
        a.joinRoom(code.value, n, chosen);
      },
    },
    h('label', { class: 'label', for: 'code' }, 'Room code'),
    code,
    h('p', { class: 'hint', id: 'code-hint' }, "It's on the conductor's screen: 4 letters, big and orange."),
    h('label', { class: 'label', for: 'name' }, 'Your name'),
    name,
    h('span', { class: 'label', id: 'lineup-label' }, 'Pick your composer'),
    h('div', { class: 'lineup', role: 'radiogroup', 'aria-labelledby': 'lineup-label' }, ...picks),
    go,
  );

  const el = h(
    'main',
    { class: 'screen join' },
    topBar(undefined, () => a.goHome()),
    h('h1', { class: 'title' }, 'Join a room'),
    hint('Three things: the code, your name, a composer. Then you pick an instrument.'),
    notice,
    form,
  );

  const update: Screen['update'] = (st) => {
    notice.hidden = !st.notice;
    replace(notice, st.notice ?? '');
    refresh(st.intent?.kind === 'join');
  };
  update(s);
  queueMicrotask(() => (code.value ? name : code).focus());
  return { el, update };
};
