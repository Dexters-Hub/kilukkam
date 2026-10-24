import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import './style.css';
import type { ClientMessage, RoomSnapshot, ServerMessage } from '@kilukkam/shared';
import { enterScreen } from './lib/anim.js';
import { playNote, preloadInstrument, thunk, unlockAudio } from './lib/audio.js';
import { CONDUCTOR_AVATAR } from './data/composers.js';
import { ServerClock } from './lib/clock.js';
import { Net, wsUrl } from './lib/net.js';
import { BeatGrid, WINDOWS, emptyTally, judge, onsets, record, type Judgement } from './lib/rhythm.js';
import { createScreen } from './screens/create.js';
import { endedScreen } from './screens/ended.js';
import { homeScreen } from './screens/home.js';
import { joinScreen } from './screens/join.js';
import { lobbyScreen } from './screens/lobby.js';
import { playScreen } from './screens/play.js';
import { stageScreen } from './screens/stage.js';
import {
  Store,
  advanceCursor,
  errorText,
  isCompleteCode,
  me,
  myTrack,
  normalizeCode,
  rejoinPlan,
  resolvePiece,
  screenKey,
  skipRests,
  type AppState,
  type ScreenKey,
} from './lib/store.js';
import { h, toast, type Actions, type Screen, type ScreenFactory } from './ui/dom.js';

const SCREENS: Record<ScreenKey, ScreenFactory> = {
  home: homeScreen,
  create: createScreen,
  join: joinScreen,
  lobby: lobbyScreen,
  play: playScreen,
  stage: stageScreen,
  ended: endedScreen,
};

const appRoot = (): HTMLElement => {
  const el = document.getElementById('app');
  if (!el) throw new Error('index.html is missing #app');
  return el;
};

const store = new Store();
const root = appRoot();
const banner = h('div', { class: 'banner', role: 'status', hidden: true });
const rttPill = h('div', { class: 'rtt-pill', 'aria-hidden': 'true', hidden: true });
document.body.append(banner, rttPill);

/** startedAt of the run our cursor belongs to; a new value means a fresh start or encore. */
let runStartedAt: number | null = null;
/** ensemble_pulse taps summed since runStartedAt; becomes the shared stat on the ended screen */
let runNotes = 0;

const startRun = (startedAt: number | null): void => {
  runStartedAt = startedAt;
  runNotes = 0;
  store.set({ tally: emptyTally() });
};

// ---------- rhythm: one shared clock and beat grid for the whole room ----------

const clock = new ServerClock();
/** Every phone counts in the same 4 beats after startedAt, so the room starts on one downbeat */
const COUNT_IN_BEATS = 4;
let grid: { key: string; grid: BeatGrid } | null = null;
const onsetCache = new Map<string, number[]>();

const currentGrid = (): BeatGrid | null => {
  const piece = store.state.piece;
  if (runStartedAt === null || !piece) return null;
  const key = `${runStartedAt}|${piece.id}`;
  if (grid?.key !== key) {
    const beat0 = runStartedAt + (COUNT_IN_BEATS * 60_000) / piece.bpm;
    grid = { key, grid: new BeatGrid(beat0, piece.bpm) };
  }
  return grid.grid;
};

const onsetsFor = (trackKey: string, events: Parameters<typeof onsets>[0]): number[] => {
  const hit = onsetCache.get(trackKey);
  if (hit) return hit;
  const o = onsets(events);
  onsetCache.set(trackKey, o);
  return o;
};

/** Offset in ms of a note played now from where the beat grid puts it, or null if unsynced. */
const offsetNow = (trackKey: string, events: Parameters<typeof onsets>[0], index: number): number | null => {
  const g = currentGrid();
  if (!g || !clock.ready) return null;
  return clock.now() - g.timeOf(onsetsFor(trackKey, events)[index] ?? 0);
};

/** The phone kicks like an instrument on a note and stutters on a dud. */
const HAPTIC_NOTE = 15;
const HAPTIC_DUD = [6, 40, 6];
/** True while a dropped player is re-sending join_room on a fresh socket */
let rejoining = false;
/** Cursor to restore once the server confirms our re-picked track mid-piece */
let resume: { trackId: string; cursor: number } | null = null;

// ---------- network ----------

const net = new Net(wsUrl(location), {
  status: (conn) => store.set({ conn }),
  rtt: (ms) => {
    rttPill.textContent = `${ms} ms`;
  },
  open: onOpen,
  message: onMessage,
});

function send(msg: ClientMessage): void {
  if (!net.send(msg)) toast('Not connected. Retrying…', 'error');
}

function onOpen(): void {
  const s = store.state;
  if (s.session?.role === 'conductor') {
    // Conductor powers live on the socket; a dropped socket closes the room.
    net.setPinging(false);
    store.set({
      session: null,
      snapshot: null,
      playerId: null,
      piece: null,
      route: 'home',
      notice: 'Your connection dropped and the room closed. Start a new one?',
    });
    return;
  }
  if (s.session?.role === 'player') {
    rejoining = true;
    net.send({ type: 'join_room', code: s.session.code, name: s.session.name, avatar: s.session.avatar });
    return;
  }
  if (s.intent) sendIntent();
}

function sendIntent(): void {
  const i = store.state.intent;
  if (!i) return;
  if (i.kind === 'create') net.send({ type: 'create_room', pieceId: i.pieceId });
  else net.send({ type: 'join_room', code: i.code, name: i.name, avatar: i.avatar });
}

function onMessage(msg: ServerMessage): void {
  const s = store.state;
  switch (msg.type) {
    case 'room_created':
      net.setPinging(true);
      startRun(msg.snapshot.startedAt);
      store.set({
        intent: null,
        notice: null,
        playerId: msg.playerId,
        session: { role: 'conductor', code: msg.code, name: 'Conductor', avatar: CONDUCTOR_AVATAR, trackId: null },
        snapshot: msg.snapshot,
        piece: resolvePiece(null, msg.snapshot.pieceId),
        cursor: 0,
      });
      return;

    case 'joined': {
      net.setPinging(true);
      const prev = s.session;
      const who = s.intent?.kind === 'join' ? s.intent : prev;
      if (!who) return;
      const wasRejoin = rejoining;
      rejoining = false;
      const plan = wasRejoin && prev ? rejoinPlan(msg.snapshot, prev, runStartedAt, s.cursor) : null;
      resume = plan?.pick && plan.resumeCursor !== null ? { trackId: plan.pick, cursor: plan.resumeCursor } : null;
      if (!resume) startRun(msg.snapshot.startedAt);
      store.set({
        intent: null,
        notice: null,
        playerId: msg.playerId,
        session: { role: 'player', code: msg.snapshot.code, name: who.name, avatar: who.avatar, trackId: prev?.trackId ?? null },
        snapshot: msg.snapshot,
        piece: msg.piece,
        cursor: 0,
      });
      // Picks are open in every phase, so a dropped phone reclaims its seat even mid-piece.
      if (plan?.pick) net.send({ type: 'pick_track', trackId: plan.pick });
      return;
    }

    case 'room_state':
      applySnapshot(msg.snapshot);
      return;

    case 'piece_started':
      if (msg.startedAt !== runStartedAt) {
        startRun(msg.startedAt);
        store.set({ cursor: 0 });
      }
      return;

    case 'piece_stopped':
      return; // room_state carries the phase change

    case 'note_echo':
      current?.screen.echo?.(msg);
      return;

    case 'ensemble_pulse':
      runNotes += msg.total;
      current?.screen.pulse?.(msg);
      return;

    case 'room_closed':
      exitRoom('home', 'The conductor closed the room. Thanks for playing!');
      return;

    case 'pong':
      clock.add(msg.t, msg.serverTime);
      return;

    case 'error':
      if (rejoining) {
        rejoining = false;
        net.setPinging(false);
        store.set({
          session: null,
          snapshot: null,
          playerId: null,
          piece: null,
          route: msg.code === 'room_not_found' ? 'home' : 'join',
          joinCode: '',
          notice: msg.code === 'room_not_found' ? 'The room has closed. Thanks for playing!' : errorText(msg.code, msg.message),
        });
        return;
      }
      resume = null;
      if (s.intent) store.set({ intent: null });
      toast(errorText(msg.code, msg.message), 'error');
      return;
  }
}

function applySnapshot(snap: RoomSnapshot): void {
  const s = store.state;
  if (s.session && s.playerId && !snap.players.some((p) => p.id === s.playerId)) {
    // Kicked: the server sends us the room without us, then closes.
    if (s.session.role === 'player') {
      exitRoom('join', 'The conductor removed you from the room.');
      return;
    }
  }
  const before = me(s)?.trackId ?? null;
  const next: Partial<AppState> = { snapshot: snap, piece: resolvePiece(s.piece, snap.pieceId) };
  const mine = snap.players.find((p) => p.id === s.playerId);
  const after = mine?.trackId ?? null;
  if (s.session && after !== s.session.trackId && (after !== null || snap.phase === 'lobby')) {
    next.session = { ...s.session, trackId: after };
  }
  if (after !== before) {
    next.cursor = resume && resume.trackId === after ? resume.cursor : 0;
    resume = null;
  }
  if (snap.phase === 'playing' && snap.startedAt !== runStartedAt) {
    startRun(snap.startedAt);
    next.cursor = 0;
  }
  if (snap.phase === 'ended' && s.snapshot?.phase !== 'ended') next.runNotes = runNotes;
  store.set(next);
  // Fetch this phone's real instrument recordings as soon as its part is known.
  const track = myTrack(store.state);
  if (track) void preloadInstrument(track.instrument);
}

/** The server is done with us (kicked, room closed): drop the room and start a fresh anonymous socket. */
function exitRoom(route: 'home' | 'join', notice: string): void {
  rejoining = false;
  resume = null;
  store.set({ session: null, snapshot: null, playerId: null, piece: null, route, joinCode: '', notice });
  net.reset();
}

// ---------- actions ----------

function leaveToHome(notice: string | null): void {
  rejoining = false;
  store.set({ session: null, snapshot: null, playerId: null, piece: null, intent: null, route: 'home', notice });
  net.reset();
}

const playSafely = (...args: Parameters<typeof playNote>): void => {
  try {
    playNote(...args);
  } catch (err) {
    // A sound glitch must never stall the room: the note still counts and the cursor moves on.
    console.error('playNote failed', err);
  }
};

/**
 * Keeps each phone in time with the room: once a note's window has passed
 * without a tap, it counts as a miss and the cursor moves on. With assist on,
 * the phone plays that note on the beat so the music stays whole.
 */
const MISS_CHECK_MS = 40;
setInterval(() => {
  const s = store.state;
  const track = myTrack(s);
  const piece = s.piece;
  if (s.snapshot?.phase !== 'playing' || !track || !piece || !clock.ready) return;
  const key = `${piece.id}/${track.id}`;
  let cursor = s.cursor;
  let tally = s.tally;
  for (;;) {
    const at = skipRests(track.events, cursor);
    const ev = track.events[at];
    const offset = ev?.kind === 'note' ? offsetNow(key, track.events, at) : null;
    if (!ev || ev.kind !== 'note' || offset === null || offset <= WINDOWS.good) break;
    if (s.assist && offset < WINDOWS.good * 3) {
      playSafely(track.instrument, ev.midi, ev.beats, piece.bpm, Math.round((ev.velocity ?? 96) * 0.8));
      net.send({ type: 'note_played', noteIndex: at });
    }
    tally = record(tally, 'miss');
    cursor = advanceCursor(track.events, at);
  }
  if (cursor !== s.cursor) store.set({ cursor, tally });
}, MISS_CHECK_MS);

const actions: Actions = {
  goHome: () => store.set({ route: 'home', notice: null, intent: null }),
  goCreate: () => store.set({ route: 'create', notice: null }),
  goJoin: (code) => store.set({ route: 'join', notice: null, ...(code ? { joinCode: code } : {}) }),

  createRoom(pieceId) {
    unlockAudio();
    store.set({ intent: { kind: 'create', pieceId }, notice: null });
    if (net.isOpen) sendIntent();
  },

  joinRoom(code, name, avatar) {
    unlockAudio();
    store.set({ intent: { kind: 'join', code, name, avatar }, notice: null, joinCode: code });
    if (net.isOpen) sendIntent();
  },

  pickTrack: (trackId) => send({ type: 'pick_track', trackId }),
  autoAssign: () => send({ type: 'auto_assign' }),
  setPiece: (pieceId) => send({ type: 'set_piece', pieceId }),
  startPiece: () => send({ type: 'start_piece' }),
  stopPiece: () => send({ type: 'stop_piece' }),
  kick: (playerId) => send({ type: 'remove_player', playerId }),

  tap() {
    unlockAudio();
    const s = store.state;
    const track = myTrack(s);
    const piece = s.piece;
    const at = track ? skipRests(track.events, s.cursor) : 0;
    const ev = track?.events[at];
    if (s.snapshot?.phase !== 'playing' || !track || !piece || ev?.kind !== 'note') {
      thunk();
      navigator.vibrate?.(HAPTIC_DUD);
      return { played: false, judgement: null };
    }
    playSafely(track.instrument, ev.midi, ev.beats, piece.bpm, ev.velocity);
    // Fire-and-forget: the note already sounded locally, a dropped echo is fine.
    net.send({ type: 'note_played', noteIndex: at });
    navigator.vibrate?.(HAPTIC_NOTE);
    const offset = offsetNow(`${piece.id}/${track.id}`, track.events, at);
    const judgement: Judgement | null = offset === null ? null : judge(offset);
    store.set({ cursor: advanceCursor(track.events, at), ...(judgement ? { tally: record(s.tally, judgement) } : {}) });
    return { played: true, judgement };
  },

  rhythm: () => {
    const g = currentGrid();
    return g ? { grid: g, clock } : null;
  },

  setAssist: (on) => store.set({ assist: on }),

  leave() {
    const conductor = store.state.session?.role === 'conductor';
    if (conductor && !confirm('Close the room for everyone?')) return;
    leaveToHome(null);
  },
};

// ---------- render ----------

let current: { key: ScreenKey; screen: Screen } | null = null;

function render(s: AppState): void {
  const key = screenKey(s);
  if (current?.key !== key) {
    current?.screen.destroy?.();
    const screen = SCREENS[key](s, actions);
    root.replaceChildren(screen.el);
    current = { key, screen };
    window.scrollTo(0, 0);
    enterScreen(screen.el);
  } else {
    current.screen.update(s);
  }

  const busy = s.session !== null || s.intent !== null;
  banner.hidden = !busy || s.conn === 'open';
  banner.textContent = s.conn === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…';
  rttPill.hidden = s.session === null || s.conn !== 'open';
  document.body.dataset.screen = key;
}

store.subscribe(render);

// Unlock audio on the very first gesture anywhere, not just on Join.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

// /?code=ABCD links straight to the join screen with the code filled.
const linked = normalizeCode(new URLSearchParams(location.search).get('code') ?? '');
if (isCompleteCode(linked)) store.set({ route: 'join', joinCode: linked });
else render(store.state);

net.connect();
