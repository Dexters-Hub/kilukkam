import '@fontsource-variable/inter';
import '../style.css';
import '../styles/tokens.css';
import './deck.css';
import { gsap } from 'gsap';
import { MAX_PLAYERS, PIECES, type InstrumentId } from '@kilukkam/shared';
import { COMPOSERS } from '../data/composers.js';
import { INSTRUMENTS, noteName } from '../lib/music.js';
import { BANK_NOTES } from '../lib/samples.js';
import { avatar, h, wordmark } from '../ui/dom.js';
import { slideFromHash } from './nav.js';

// The pitch deck. Every number on it is read from the real piece library
// and roster, so it stays true as features land.

type Child = Parameters<typeof h>[2];

interface Slide {
  label: string;
  build: () => HTMLElement;
}

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const slide = (cls: string, ...children: Child[]): HTMLElement =>
  h('section', { class: `slide ${cls}` }, h('div', { class: 'slide-inner' }, ...children));

const kicker = (text: string): HTMLElement => h('p', { class: 'kicker reveal' }, text);
const title = (text: string): HTMLElement => h('h2', { class: 'slide-title reveal' }, text);
const lede = (text: string): HTMLElement => h('p', { class: 'slide-lede reveal' }, text);

const card = (heading: string, body: string, tint = 'var(--accent)'): HTMLElement => {
  const el = h('div', { class: 'deck-card reveal' }, h('strong', {}, heading), h('span', {}, body));
  el.style.setProperty('--tint', tint);
  return el;
};

const stat = (value: string | number, label: string): HTMLElement =>
  h('div', { class: 'stat reveal' }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label));

const instrumentChip = (id: InstrumentId): HTMLElement => {
  const meta = INSTRUMENTS[id];
  const el = h('span', { class: 'chip reveal' }, h('span', { 'aria-hidden': 'true' }, meta.emoji), meta.label);
  el.style.setProperty('--tint', meta.color);
  return el;
};

const joinUrl = (): string => `${location.protocol}//${location.host}/`;
const isLocalOnly = (): boolean => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);

const library = () => {
  const tracks = PIECES.flatMap((p) => p.tracks);
  const notes = tracks.reduce((n, t) => n + t.events.filter((e) => e.kind === 'note').length, 0);
  const instruments = new Set(tracks.map((t) => t.instrument));
  return { pieces: PIECES.length, tracks: tracks.length, notes, instruments: [...instruments] };
};

const SLIDES: readonly Slide[] = [
  {
    label: 'Kilukkam',
    build: () =>
      slide(
        'slide-title-card',
        h('p', { class: 'badge reveal' }, 'Track 4 · Make room for play'),
        h('div', { class: 'reveal hero-mark' }, wordmark('hero')),
        h('p', { class: 'slide-lede reveal' }, 'A room full of phones becomes an orchestra.'),
        h('div', { class: 'lineup-strip reveal', 'aria-hidden': 'true' }, ...COMPOSERS.slice(0, 7).map((c) => avatar(c.id, { size: 'lg' }))),
      ),
  },
  {
    label: 'The gap',
    build: () =>
      slide(
        'slide-problem',
        kicker('The gap'),
        title('Everyone in the room has a phone. Nobody has an orchestra.'),
        h(
          'div',
          { class: 'grid-2' },
          card('Phones pull a room apart', 'Ten people, ten private screens. The device in every pocket is the reason nobody is looking up.'),
          card('Music needs practice', 'Playing together is one of the best feelings there is, and it usually takes years of lessons to earn.'),
        ),
      ),
  },
  {
    label: 'The idea',
    build: () =>
      slide(
        'slide-idea',
        kicker('The idea'),
        title('A handbell choir, made of phones.'),
        lede('Each phone holds one part of a song, from Pachelbel to your playlist. Every tap plays your next note, on the beat, and the room scores like a rhythm game.'),
        h(
          'div',
          { class: 'phones reveal', 'aria-hidden': 'true' },
          ...(['flute', 'violin', 'piano', 'cello', 'drums'] as const).map((id, i) => {
            const meta = INSTRUMENTS[id];
            const track = PIECES.flatMap((p) => p.tracks).find((t) => t.instrument === id);
            const first = track?.events.find((e) => e.kind === 'note');
            const phone = h(
              'div',
              { class: 'mini-phone' },
              h('span', { class: 'mini-inst' }, `${meta.emoji} ${meta.label}`),
              h('span', { class: 'mini-note' }, first?.kind === 'note' ? noteName(first.midi) : '♪'),
              h('span', { class: 'mini-tap' }, 'tap'),
            );
            phone.style.setProperty('--tint', meta.color);
            phone.style.setProperty('--i', String(i));
            return phone;
          }),
        ),
      ),
  },
  {
    label: 'How it plays',
    build: () =>
      slide(
        'slide-steps',
        kicker('How it plays'),
        title('Understood in three seconds.'),
        h(
          'ol',
          { class: 'steps-big' },
          h('li', { class: 'reveal' }, h('span', { class: 'step-n' }, '1'), h('strong', {}, 'A conductor opens a room'), h('span', {}, 'with a piece, a game-style original, or any song on Spotify.')),
          h('li', { class: 'reveal' }, h('span', { class: 'step-n' }, '2'), h('strong', {}, 'Friends join with a 4-letter code'), h('span', {}, 'pick a composer avatar and get an instrument straight away.')),
          h('li', { class: 'reveal' }, h('span', { class: 'step-n' }, '3'), h('strong', {}, 'Everyone taps on the beat'), h('span', {}, 'while the conductor leads with a hand in front of the camera.')),
        ),
      ),
  },
  {
    label: 'Play it now',
    build: () =>
      slide(
        'slide-live',
        h(
          'div',
          { class: 'live-copy' },
          kicker('Live demo'),
          title('Grab your phone.'),
          lede('Same Wi-Fi, open this address, tap “Join with code”.'),
          h('p', { class: 'join-url reveal' }, joinUrl()),
          isLocalOnly()
            ? h('p', { class: 'deck-note reveal' }, 'Presenter: open this deck from your LAN address (not localhost) so phones can reach it.')
            : null,
        ),
        h(
          'div',
          { class: 'device reveal' },
          h('iframe', { class: 'device-screen', src: '/', title: 'Kilukkam running live', loading: 'lazy', tabindex: '-1' }),
        ),
      ),
  },
  {
    label: 'Why it is fun',
    build: () =>
      slide(
        'slide-fun',
        kicker('Why it is fun'),
        title('Instant cause and effect, multiplied by the room.'),
        h(
          'div',
          { class: 'grid-3' },
          card('Zero learning curve', 'If you can tap, you can play. The big note on screen tells you what you are about to sound.', 'var(--flute)'),
          card('Your phone is the instrument', 'Each tap sounds on your own speaker with a little haptic kick, so the music comes from where people sit.', 'var(--violin)'),
          card('You can see the ensemble', 'The conductor screen ripples with every note from every section, so the room can watch itself play.', 'var(--piano)'),
          card('Real music, real structure', 'Canon in D enters in true canon: Violin II waits two bars, Violin III four. The room feels the round.', 'var(--cello)'),
          card('A festival lineup of you', 'Players join as Bach, Clara Schumann, Debussy or A.R. Rahman.', 'var(--accent)'),
          card('Encore', 'One tap from the conductor and the whole room plays it again, tighter this time.', 'var(--flute)'),
        ),
      ),
  },
  {
    label: 'Your hand is the baton',
    build: () => {
      const zone = (label: string, where: string, id: InstrumentId): HTMLElement => {
        const el = h('div', { class: 'zone reveal' }, h('strong', {}, label), h('span', {}, where));
        el.style.setProperty('--tint', INSTRUMENTS[id].color);
        return el;
      };
      return slide(
        'slide-camera',
        kicker('Camera conductor'),
        title('Your hand is the baton.'),
        lede('The laptop camera follows the conductor’s hand, on the device: no video leaves the room. Every gesture drives the whole orchestra.'),
        h('div', { class: 'zones' }, zone('Violins', 'point left', 'violin'), zone('Flutes', 'point centre', 'flute'), zone('Cellos', 'point right', 'cello')),
        h(
          'div',
          { class: 'grid-2' },
          card('Beat the pattern', '4/4, 3/4 waltz and 2/4 march. Hit each numbered target as its ring closes; levels get faster and switch the swish.', 'var(--accent)'),
          card('Bigger is louder', 'Large sweeping beats play forte, small careful ones piano. The room follows your dynamics live.', 'var(--piano)'),
          card('Point to cue', 'Point into a third of the picture and hold: that section comes in. The labels show which third is which.', 'var(--violin)'),
          card('Fist to cut off', 'Close your fist and hold it. The whole room stops on your mark.', 'var(--cello)'),
        ),
      );
    },
  },
  {
    label: 'Any song, with drums',
    build: () =>
      slide(
        'slide-songs',
        kicker('Any song'),
        title('Bring the track. The room brings the band.'),
        lede('Search Spotify, tap along to find the beat, and the room plays drums, claps, bass, pads and fingerstyle guitar in time with the real recording.'),
        h('div', { class: 'chips' }, ...(['drums', 'guitar', 'piano', 'cello', 'flute', 'violin'] as const).map(instrumentChip)),
        h(
          'div',
          { class: 'grid-3' },
          card('Drums', 'A synthesised kit: kick, snare, hats, toms and crash, on its own phones.', 'var(--drums)'),
          card('Game-style originals', 'Boss Rush, Pixel Plains and Hallowed Depths, written for the room, with drum parts.', 'var(--accent)'),
          card('The classics', 'Canon in D in true canon, Ode to Joy for a first run.', 'var(--flute)'),
        ),
      ),
  },
  {
    label: 'The lineup',
    build: () =>
      slide(
        'slide-lineup',
        kicker('The lineup'),
        title(`${COMPOSERS.length} composers. Pick who you play as.`),
        h(
          'div',
          { class: 'poster' },
          ...COMPOSERS.map((c) => h('div', { class: 'poster-item reveal' }, avatar(c.id, { size: 'lg' }), h('span', {}, c.displayName))),
        ),
      ),
  },
  {
    label: 'Under the hood',
    build: () => {
      const lib = library();
      return slide(
        'slide-tech',
        kicker('Under the hood'),
        title('The server is the referee, never the clock.'),
        h(
          'div',
          { class: 'grid-2 tech' },
          h(
            'ul',
            { class: 'tech-list reveal' },
            h('li', {}, h('strong', {}, 'Every phone plays its own instrument'), ' in WebAudio: real recordings (VSCO 2 CE, public domain) for strings, flute and piano, a synthesised drum kit and a plucked-string guitar.'),
            h('li', {}, h('strong', {}, 'One small WebSocket server'), ' owns rooms, seats and phases. A tap is a single tiny message, so latency barely matters.'),
            h('li', {}, h('strong', {}, 'Built for a full room'), ' with aggregated ensemble pulses instead of a hundred-fold echo storm.'),
            h('li', {}, h('strong', {}, 'Scores are code'), ': canon offsets are computed, not copied, and validated by tests.'),
          ),
          h(
            'div',
            { class: 'stats' },
            stat(MAX_PLAYERS, 'phones per room'),
            stat(lib.pieces, 'pieces'),
            stat(lib.tracks, 'instrument parts'),
            stat(lib.notes.toLocaleString(), 'playable notes'),
            stat(Object.values(BANK_NOTES).reduce((n, b) => n + b.length, 0), 'recorded notes'),
            stat(lib.instruments.length, 'instruments'),
          ),
        ),
        h('div', { class: 'chips' }, ...lib.instruments.map(instrumentChip)),
      );
    },
  },
  {
    label: 'Built with',
    build: () =>
      slide(
        'slide-stack',
        kicker('Built with'),
        title('Small, fast, local-first.'),
        h(
          'div',
          { class: 'stack-chips' },
          ...['TypeScript (strict)', 'React 19', 'Vite', 'WebAudio', 'WebSocket', 'GSAP', 'MediaPipe hands', 'Spotify Web API', 'Vitest', 'Playwright'].map((t) => h('span', { class: 'chip chip-lg reveal' }, t)),
        ),
        lede('No accounts to play. One laptop on the room’s Wi-Fi runs the whole show; hand tracking runs on the device.'),
      ),
  },
  {
    label: 'What’s next',
    build: () =>
      slide(
        'slide-next',
        kicker('What’s next'),
        title('From a party trick to a room-scale instrument.'),
        h(
          'div',
          { class: 'grid-2' },
          card('Section leaderboards', 'Who held the beat best: per player and per section, shared at the end.'),
          card('Your own MIDI', 'Drop in a file and it is arranged into parts for the room, right from the app.'),
          card('Hum it', 'Sing a melody into the conductor laptop and the room plays it back as an ensemble.'),
          card('Rooms anywhere', 'The game core is socket-free, so it moves to the edge and fills concert halls.'),
        ),
      ),
  },
  {
    label: 'Thanks',
    build: () =>
      slide(
        'slide-end',
        h('div', { class: 'reveal hero-mark' }, wordmark('hero')),
        title('Let’s play something together.'),
        h('p', { class: 'join-url reveal' }, joinUrl()),
      ),
  },
];

// ---------- presenter ----------

const root = document.getElementById('deck');
if (!root) throw new Error('#deck missing from demo.html');

const slides = SLIDES.map((s) => s.build());
const progress = h('div', { class: 'deck-progress', 'aria-hidden': 'true' }, h('span', {}));
const counter = h('p', { class: 'deck-counter', 'aria-live': 'polite' });
const prevBtn = h('button', { class: 'deck-nav deck-prev', 'aria-label': 'Previous slide' }, '←');
const nextBtn = h('button', { class: 'deck-nav deck-next', 'aria-label': 'Next slide' }, '→');
root.append(...slides, progress, counter, prevBtn, nextBtn);

let current = -1;

const show = (target: number): void => {
  const next = Math.max(0, Math.min(slides.length - 1, target));
  if (next === current) return;
  const forward = next > current;
  const from = slides[current];
  const to = slides[next];
  if (!to) return;
  current = next;

  for (const s of slides) s.toggleAttribute('data-active', s === to);
  to.setAttribute('aria-label', `${next + 1} of ${slides.length}: ${SLIDES[next]?.label ?? ''}`);
  counter.textContent = `${next + 1} / ${slides.length}`;
  progress.style.setProperty('--p', String((next + 1) / slides.length));
  prevBtn.disabled = next === 0;
  nextBtn.disabled = next === slides.length - 1;
  history.replaceState(null, '', `#${next + 1}`);

  if (reducedMotion()) return;
  if (from) gsap.fromTo(from, { autoAlpha: 1, x: 0 }, { autoAlpha: 0, x: forward ? -40 : 40, duration: 0.35, ease: 'power2.in', clearProps: 'transform' });
  gsap.fromTo(to, { autoAlpha: 0, x: forward ? 40 : -40 }, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out', delay: from ? 0.12 : 0 });
  gsap.fromTo(
    to.querySelectorAll('.reveal'),
    { autoAlpha: 0, y: 18 },
    { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.06, delay: from ? 0.22 : 0.1, clearProps: 'transform,opacity,visibility' },
  );
};

prevBtn.addEventListener('click', () => show(current - 1));
nextBtn.addEventListener('click', () => show(current + 1));

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) show(current + 1);
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) show(current - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f') void document.documentElement.requestFullscreen?.();
  else return;
  e.preventDefault();
});

// Swipe on touch screens; taps stay free for the live demo iframe and buttons.
let touchX: number | null = null;
root.addEventListener('touchstart', (e) => (touchX = e.touches[0]?.clientX ?? null), { passive: true });
root.addEventListener('touchend', (e) => {
  const end = e.changedTouches[0]?.clientX;
  if (touchX === null || end === undefined) return;
  const dx = end - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
});

window.addEventListener('hashchange', () => show(slideFromHash(location.hash, slides.length)));
show(slideFromHash(location.hash, slides.length));
