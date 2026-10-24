import { CODE_LEN, PIECES, type InstrumentId, type Score, type ScoreEvent } from '@kilukkam/shared';
import { floatNote, marquee, revealOnScroll, ring, swapText } from '../lib/anim.js';
import { playNote, preloadInstrument, unlockAudio } from '../lib/audio.js';
import { COMPOSERS } from '../data/composers.js';
import { icon, type IconName } from '../ui/icons.js';
import { INSTRUMENTS, noteName } from '../lib/music.js';
import { advanceCursor, isCompleteCode, normalizeCode, skipRests } from '../lib/store.js';
import type { Screen, ScreenFactory } from '../ui/dom.js';
import { avatar, h, replace, wordmark } from '../ui/dom.js';

// The landing page is the game: a playable instrument above the fold and a
// game-PIN box to jump into a room. Words are kept to a minimum.

const TRY_PIECE_ID = 'ode-to-joy';
const INSTRUMENT_ORDER: readonly InstrumentId[] = ['violin', 'flute', 'piano', 'cello'];
const ARTICLE: Record<InstrumentId, string> = { violin: 'a violin', flute: 'a flute', piano: 'a piano', cello: 'a cello' };

const STRIP: readonly { icon: IconName; label: string }[] = [
  { icon: 'magic-wand', label: 'One conducts' },
  { icon: 'qr-code', label: 'Everyone joins' },
  { icon: 'hand-tap', label: 'The room plays' },
];

/** The playable stage: instrument tabs and a big pad playing that instrument's real part. */
const tryPad = (piece: Score | undefined, onInstrument: (id: InstrumentId) => void) => {
  let instrument: InstrumentId = INSTRUMENT_ORDER[0] ?? 'violin';
  let cursor = 0;
  let played = 0;
  const eventsFor = (id: InstrumentId): readonly ScoreEvent[] => piece?.tracks.find((t) => t.instrument === id)?.events ?? [];

  const noteEl = h('span', { class: 'pad-note' });
  const nextEl = h('span', { class: 'pad-next', 'aria-hidden': 'true' });
  const notes = h('div', { class: 'pad-float', 'aria-hidden': 'true' });
  const pad = h('button', { class: 'pad', 'aria-label': 'Play the next note' }, notes, noteEl, h('span', { class: 'pad-hint' }, 'tap'));
  const caption = h('p', { class: 'stage-caption' });
  const tabs = h('div', { class: 'stage-tabs', role: 'tablist', 'aria-label': 'Instrument' });
  const stage = h('section', { class: 'stage', 'aria-label': 'Try it' }, tabs, pad, nextEl, caption);

  const paint = () => {
    const meta = INSTRUMENTS[instrument];
    stage.style.setProperty('--tint', meta.color);
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor);
    const current = events[at];
    const upcoming = events.slice(at + 1).filter((e) => e.kind === 'note').slice(0, 2);
    replace(noteEl, current?.kind === 'note' ? noteName(current.midi) : '♪');
    replace(nextEl, ...upcoming.map((e) => h('span', {}, e.kind === 'note' ? noteName(e.midi) : '')));
    replace(caption, played === 0 ? 'Tap the circle. That’s the whole game.' : played < 8 ? `Ode to Joy, the ${meta.label.toLowerCase()} part. Keep going.` : 'Now picture a hundred phones doing this.');
    for (const tab of tabs.children) {
      const on = (tab as HTMLElement).dataset.id === instrument;
      tab.classList.toggle('on', on);
      tab.setAttribute('aria-selected', String(on));
    }
  };

  replace(
    tabs,
    ...INSTRUMENT_ORDER.map((id) => {
      const tab = h(
        'button',
        {
          class: 'stage-tab',
          role: 'tab',
          'data-id': id,
          'aria-label': INSTRUMENTS[id].label,
          onclick: () => {
            if (id === instrument) return;
            instrument = id;
            cursor = 0;
            void preloadInstrument(id);
            onInstrument(id);
            paint();
          },
        },
        icon(id, 26),
        h('span', {}, INSTRUMENTS[id].label),
      );
      tab.style.setProperty('--tint', INSTRUMENTS[id].color);
      return tab;
    }),
  );

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor);
    const ev = events[at];
    if (!ev || ev.kind !== 'note' || !piece) {
      cursor = 0;
      paint();
      return;
    }
    playNote(instrument, ev.midi, ev.beats, piece.bpm, ev.velocity);
    navigator.vibrate?.(8);
    ring(pad);
    floatNote(notes);
    played++;
    const next = advanceCursor(events, at);
    cursor = next >= events.length ? 0 : next;
    paint();
  });

  void preloadInstrument(instrument);
  paint();
  return stage;
};

/** Kahoot-style game PIN right on the landing page. */
const pinBox = (onCode: (code: string) => void) => {
  const input = h('input', {
    class: 'pin-input',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: CODE_LEN + 2,
    placeholder: 'CODE',
    'aria-label': 'Room code',
  });
  const go = h('button', { class: 'pin-go', type: 'button', 'aria-label': 'Join this room', disabled: true }, icon('arrow-right', 24));
  const submit = () => {
    if (isCompleteCode(input.value)) onCode(input.value);
  };
  input.addEventListener('input', () => {
    const n = normalizeCode(input.value);
    if (n !== input.value) input.value = n;
    go.disabled = !isCompleteCode(n);
    if (isCompleteCode(n)) submit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  go.addEventListener('click', submit);
  return h('div', { class: 'pin' }, h('span', { class: 'pin-label' }, 'Got a code?'), input, go);
};

export const homeScreen: ScreenFactory = (s, a) => {
  const notice = h('p', { class: 'notice', role: 'status' });
  const piece = PIECES.find((p) => p.id === TRY_PIECE_ID);
  const word = h('span', { class: 'hero-word' }, ARTICLE[INSTRUMENT_ORDER[0] ?? 'violin']);

  const legends = h(
    'div',
    { class: 'legend-track' },
    ...[...COMPOSERS, ...COMPOSERS].map((c) => h('span', { class: 'legend-item' }, avatar(c.id, { size: 'md' }), c.displayName)),
  );

  const el = h(
    'main',
    { class: 'screen home' },
    h('header', { class: 'top' }, wordmark('bar'), h('button', { class: 'pill', onclick: () => a.goCreate() }, icon('magic-wand', 18), 'Conduct')),
    notice,
    h('h1', { class: 'hero-title' }, 'Your phone is ', word, '.'),
    tryPad(piece, (id) => swapText(word, ARTICLE[id])),
    pinBox((code) => a.goJoin(code)),
    h(
      'p',
      { class: 'home-alt' },
      'No code yet? ',
      h('button', { class: 'link', onclick: () => a.goCreate() }, 'Start a room as the conductor', icon('caret-right', 14)),
    ),
    h('ol', { class: 'strip reveal', 'aria-label': 'How it plays' }, ...STRIP.map((step) => h('li', {}, h('span', { class: 'strip-icon' }, icon(step.icon, 30)), step.label))),
    h(
      'section',
      { class: 'legend reveal', 'aria-label': 'Composer avatars' },
      h('h2', { class: 'section-title' }, 'Play as a legend'),
      h('div', { class: 'legend-window', 'aria-hidden': 'true' }, legends),
    ),
    h('p', { class: 'home-foot' }, icon('speaker-high', 18), 'Volume up, ringer on.'),
  );

  const stopMarquee = marquee(legends);
  queueMicrotask(() => revealOnScroll(el.querySelectorAll('.reveal')));

  const update: Screen['update'] = (st) => {
    notice.hidden = !st.notice;
    replace(notice, st.notice ?? '');
  };
  update(s);
  return { el, update, destroy: stopMarquee };
};
