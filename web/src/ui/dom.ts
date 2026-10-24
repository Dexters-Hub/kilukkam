import { CONDUCTOR_AVATAR, composerFor, portraitUrl } from '../data/composers.js';
import type { ServerClock } from '../lib/clock.js';
import type { BeatGrid, Judgement } from '../lib/rhythm.js';
import type { AppState } from '../lib/store.js';

// Tiny DOM helpers. Strings always go in as text nodes, never HTML, so
// player names and room codes can't inject markup.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

export const append = (el: Node, children: readonly Child[]): void => {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
};

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
};

export const replace = (el: Element, ...children: Child[]): void => {
  el.replaceChildren();
  append(el, children);
};

/** Joins the truthy class names: cx('av', mine && 'mine') */
export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

export interface NoteEcho {
  playerId: string;
  trackId: string;
  noteIndex: number;
}

/** Taps per track since the last pulse (~4 Hz), from ensemble_pulse */
export interface EnsemblePulse {
  counts: Record<string, number>;
  total: number;
}

export interface Screen {
  el: HTMLElement;
  update(s: AppState): void;
  /** Conductor only: one frame per tap */
  echo?(e: NoteEcho): void;
  /** Everyone: aggregate taps, drives ambient room visuals */
  pulse?(p: EnsemblePulse): void;
  destroy?(): void;
}

export interface Actions {
  goHome(): void;
  goCreate(): void;
  /** Open the join screen, optionally with a code already typed on home */
  goJoin(code?: string): void;
  createRoom(pieceId: string): void;
  joinRoom(code: string, name: string, avatar: string): void;
  pickTrack(trackId: string): void;
  autoAssign(): void;
  setPiece(pieceId: string): void;
  startPiece(): void;
  stopPiece(): void;
  kick(playerId: string): void;
  /** Play my next note; `played` is false when there was nothing to play */
  tap(): TapResult;
  /** Shared clock and beat grid for the current run (null outside a run) */
  rhythm(): RhythmView | null;
  setAssist(on: boolean): void;
  leave(): void;
}

export interface TapResult {
  played: boolean;
  /** How close to the beat it landed; null when the clock is not synced yet */
  judgement: Judgement | null;
}

export interface RhythmView {
  grid: BeatGrid;
  clock: ServerClock;
}

export type ScreenFactory = (s: AppState, a: Actions) => Screen;

// ---------- avatar ----------

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarOptions {
  size?: AvatarSize | undefined;
  /** Player name, for the accessible label */
  name?: string | undefined;
  pid?: string | undefined;
  mine?: boolean | undefined;
  away?: boolean | undefined;
}

/**
 * The one avatar disc used everywhere: an era-tinted composer monogram,
 * the conductor's 🎼, or (for an id we don't know) the name's initial.
 */
export const avatar = (id: string, opts: AvatarOptions = {}): HTMLElement => {
  const composer = composerFor(id);
  const conductor = id === CONDUCTOR_AVATAR;
  const who = conductor ? 'Conductor' : (composer?.fullName ?? '');
  const label = [opts.name, who].filter(Boolean).join(' · ');
  const mark = conductor ? CONDUCTOR_AVATAR : (composer?.monogram ?? [...(opts.name ?? '?')][0] ?? '?');
  const el = h(
    'span',
    {
      class: cx('av', `av-${opts.size ?? 'md'}`, composer ? 'av-composer' : 'av-plain', opts.mine && 'mine', opts.away && 'away'),
      role: 'img',
      'aria-label': label || 'Player',
      title: label || undefined,
      'data-pid': opts.pid,
      'data-wide': (composer?.monogram.length ?? 1) > 1,
    },
    h('span', { class: 'av-mono', 'aria-hidden': 'true' }, mark),
  );
  if (composer) {
    el.style.setProperty('--era', composer.eraColor);
    // The monogram stays underneath as the fallback if the portrait can't load.
    const img = h('img', { class: 'av-portrait', src: portraitUrl(composer), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    el.append(img);
  }
  return el;
};

// ---------- toasts ----------

export const toast = (text: string, kind: 'error' | 'info' = 'info', ms = 3200): void => {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild?.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 300);
  }, ms);
};

// ---------- shared bits ----------

/** Kilukkam in Latin display type with the Malayalam name beside (bar) or under (hero) it. */
export const wordmark = (size: 'bar' | 'hero' = 'bar'): HTMLElement =>
  h(
    'span',
    { class: cx('wordmark', `wordmark-${size}`) },
    size === 'bar' ? h('img', { class: 'wordmark-mark', src: '/icon.svg', alt: '', width: 30, height: 30 }) : null,
    h('span', { class: 'wordmark-words' }, h('span', { class: 'wordmark-en' }, 'Kilukkam'), h('span', { class: 'wordmark-ml', lang: 'ml' }, 'കിലുക്കം')),
  );

export const topBar = (right?: Child, onBack?: () => void): HTMLElement =>
  h(
    'header',
    { class: 'top' },
    onBack ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: onBack }, '←') : wordmark(),
    right ?? null,
  );

/** One short line telling a first-timer what this screen wants from them. */
export const hint = (text: string): HTMLElement => h('p', { class: 'hint' }, text);

export const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / storage blocked: preferences just don't stick
  }
};
