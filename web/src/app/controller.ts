import type { ClientMessage, DjCue, DynamicsLevel, RoomSnapshot, ServerMessage, Track } from '@kilukkam/shared';
import { CONDUCTOR_AVATAR } from '../data/composers.js';
import { playNote, preloadInstrument, thunk, unlockAudio } from '../lib/audio.js';
import { ServerClock } from '../lib/clock.js';
import { Net, wsUrl } from '../lib/net.js';
import { BeatGrid, WINDOWS, emptyTally, judge, onsets, record, type Judgement } from '../lib/rhythm.js';
import {
  Store,
  advanceCursor,
  errorText,
  me,
  myTrack,
  rejoinPlan,
  resolvePiece,
  skipRests,
  type AppState,
} from '../lib/store.js';
import { toast } from '../components/Toast.js';
import { BEATS_PER_BAR, DYNAMICS_GAIN, barNotes, buildEntry, nextBar } from './cues.js';
import { emitLive } from './live.js';

// The engine behind the React screens: one socket, one store, one shared
// clock. Nothing here imports React; screens read the store through
// useSyncExternalStore and live frames through `onLive`.

export const store = new Store();

/** startedAt of the run our cursor belongs to; a new value means a fresh start or encore. */
let runStartedAt: number | null = null;
/** ensemble_pulse taps summed since runStartedAt; becomes the shared stat on the ended screen */
let runNotes = 0;

/** Live DJ state on this phone; reset with every run */
interface Dj {
  /** Server ms until which this phone stays silent (drop) */
  dropUntil: number;
  /** Notes of the bar being repeated; taps cycle through them */
  loop: { notes: number[]; next: number } | null;
  /** Server ms this phone's section enters during a build, and when the build ends */
  build: { enter: number; until: number } | null;
}
let dj: Dj = { dropUntil: 0, loop: null, build: null };

const startRun = (startedAt: number | null): void => {
  runStartedAt = startedAt;
  runNotes = 0;
  dj = { dropUntil: 0, loop: null, build: null };
  store.set({ tally: emptyTally() });
};

// ---------- rhythm: one shared clock and beat grid for the whole room ----------

export const clock = new ServerClock();
/** Beats the countdown counts aloud before the first downbeat (a count-in start leaves ~3 s for it) */
export const COUNT_IN_BEATS = 4;
let grid: { key: string; grid: BeatGrid } | null = null;
const onsetCache = new Map<string, number[]>();

/** The room's beat grid: beat 0 is startedAt, then the server's tempo anchors. */
const currentGrid = (): BeatGrid | null => {
  const piece = store.state.piece;
  if (runStartedAt === null || !piece) return null;
  const key = `${runStartedAt}|${piece.id}`;
  if (grid?.key !== key) {
    const g = new BeatGrid(runStartedAt, piece.bpm);
    // Arriving mid-run after a tempo change: adopt the room's current anchor.
    const tempo = store.state.snapshot?.tempo;
    if (tempo) g.anchor(tempo);
    grid = { key, grid: g };
  }
  return grid.grid;
};

const onsetsFor = (track: Track): number[] => {
  const key = `${store.state.piece?.id}/${track.id}`;
  const hit = onsetCache.get(key);
  if (hit) return hit;
  const o = onsets(track.events);
  onsetCache.set(key, o);
  return o;
};

/** Offset in ms of a note played now from where the beat grid puts it, or null if unsynced. */
const offsetNow = (track: Track, index: number): number | null => {
  const g = currentGrid();
  if (!g || !clock.ready) return null;
  return clock.now() - g.timeOf(onsetsFor(track)[index] ?? 0);
};

const isMuted = (s: AppState, trackId: string): boolean => s.snapshot?.mutedTracks.includes(trackId) ?? false;

/** Loudness for a note played right now: dynamics times the build fade-in */
const levelNow = (s: AppState): number => {
  const base = DYNAMICS_GAIN[s.snapshot?.dynamics ?? 'mf'];
  const b = dj.build;
  if (!b || !clock.ready) return base;
  const now = clock.now();
  if (now >= b.until) {
    dj.build = null;
    return base;
  }
  return now < b.enter ? base * 0.15 : base;
};

const silentNow = (): boolean => clock.ready && clock.now() < dj.dropUntil;

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
  rtt: (ms) => emitLive('rtt', ms),
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

    case 'piece_changed':
      onsetCache.clear();
      store.set({ piece: msg.piece });
      return;

    case 'piece_started':
      if (msg.startedAt !== runStartedAt) {
        startRun(msg.startedAt);
        store.set({ cursor: 0 });
      }
      return;

    case 'piece_stopped':
      return; // room_state carries the phase change

    case 'tempo':
      // The server's anchor is the truth: beat `beat` at `at`, then `bpm`, on every phone alike.
      currentGrid()?.anchor({ bpm: msg.bpm, at: msg.at, beat: msg.beat });
      emitLive('tempo', { bpm: msg.bpm });
      return;

    case 'dj':
      applyDj(msg.cue, msg.at, msg.bars);
      return;

    case 'dynamics':
      emitLive('dynamics', msg.level);
      return;

    case 'note_echo':
      emitLive('echo', msg);
      return;

    case 'ensemble_pulse':
      runNotes += msg.total;
      emitLive('pulse', msg);
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

/** Apply a DJ cue on this phone: drop = silence to the next bar, loop = repeat the current bar, build = sections fade in by score order. */
function applyDj(cue: DjCue, at: number, bars?: number): void {
  const s = store.state;
  const g = currentGrid();
  const track = myTrack(s);
  const beat = g ? g.beatAt(at) : 0;
  const barMs = g ? (BEATS_PER_BAR * 60_000) / g.bpm : 2000;
  let until: number | null = null;
  switch (cue) {
    case 'drop':
      dj.dropUntil = g ? g.timeOf(nextBar(beat, bars)) : at + barMs;
      until = dj.dropUntil;
      break;
    case 'build': {
      const span = Math.max(1, bars ?? 4) * barMs;
      const order = track && s.piece ? s.piece.tracks.findIndex((t) => t.id === track.id) : 0;
      dj.build = { enter: at + buildEntry(order, s.piece?.tracks.length ?? 1, span), until: at + span };
      until = dj.build.until;
      break;
    }
    case 'loop_on':
      dj.loop = { notes: track ? barNotes(track.events, onsetsFor(track), beat, bars) : [], next: 0 };
      break;
    case 'loop_off':
      dj.loop = null;
      resync();
      break;
  }
  emitLive('dj', { cue, at, until });
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

/** Skip notes whose moment has passed without scoring them (resting section, end of a loop). */
function resync(): void {
  const s = store.state;
  const track = myTrack(s);
  if (!track || !clock.ready) return;
  let cursor = s.cursor;
  for (;;) {
    const at = skipRests(track.events, cursor);
    const offset = track.events[at]?.kind === 'note' ? offsetNow(track, at) : null;
    if (offset === null || offset <= WINDOWS.good) break;
    cursor = advanceCursor(track.events, at);
  }
  if (cursor !== s.cursor) store.set({ cursor });
}

/**
 * Keeps each phone in time with the room: once a note's window has passed
 * without a tap, it counts as a miss and the cursor moves on. With assist on,
 * the phone plays that note on the beat so the music stays whole. A muted
 * section rests: its cursor follows the room silently, unscored.
 */
const MISS_CHECK_MS = 40;
setInterval(() => {
  const s = store.state;
  const track = myTrack(s);
  const piece = s.piece;
  if (s.snapshot?.phase !== 'playing' || !track || !piece || !clock.ready || dj.loop) return;
  if (isMuted(s, track.id)) {
    resync();
    return;
  }
  const bpm = currentGrid()?.bpm ?? piece.bpm;
  let cursor = s.cursor;
  let tally = s.tally;
  for (;;) {
    const at = skipRests(track.events, cursor);
    const ev = track.events[at];
    const offset = ev?.kind === 'note' ? offsetNow(track, at) : null;
    if (!ev || ev.kind !== 'note' || offset === null || offset <= WINDOWS.good) break;
    if (s.assist && offset < WINDOWS.good * 3) {
      if (!silentNow()) playSafely(track.instrument, ev.midi, ev.beats, bpm, Math.round((ev.velocity ?? 96) * 0.8), { level: levelNow(s) });
      net.send({ type: 'note_played', noteIndex: at });
    }
    tally = record(tally, 'miss');
    cursor = advanceCursor(track.events, at);
  }
  if (cursor !== s.cursor) store.set({ cursor, tally });
}, MISS_CHECK_MS);

// ---------- actions ----------

export interface TapResult {
  played: boolean;
  /** The section is resting (conductor muted it): not a mistake, just wait */
  resting: boolean;
  /** How close to the beat it landed; null when the clock is not synced yet */
  judgement: Judgement | null;
}

export interface RhythmView {
  grid: BeatGrid;
  clock: ServerClock;
}

let throttledTempo: ReturnType<typeof setTimeout> | null = null;
let pendingBpm: number | null = null;

export const actions = {
  goHome: () => store.set({ route: 'home', notice: null, intent: null }),
  goCreate: () => store.set({ route: 'create', notice: null }),
  /** Open the join screen, optionally with a code already typed on home */
  goJoin: (code?: string) => store.set({ route: 'join', notice: null, ...(code ? { joinCode: code } : {}) }),

  createRoom(pieceId: string) {
    unlockAudio();
    store.set({ intent: { kind: 'create', pieceId }, notice: null });
    if (net.isOpen) sendIntent();
  },

  joinRoom(code: string, name: string, avatar: string) {
    unlockAudio();
    store.set({ intent: { kind: 'join', code, name, avatar }, notice: null, joinCode: code });
    if (net.isOpen) sendIntent();
  },

  pickTrack: (trackId: string) => send({ type: 'pick_track', trackId }),
  autoAssign: () => send({ type: 'auto_assign' }),
  setPiece: (pieceId: string) => send({ type: 'set_piece', pieceId }),
  startPiece: (countIn: boolean) => send(countIn ? { type: 'start_piece', countIn: true } : { type: 'start_piece' }),
  stopPiece: () => send({ type: 'stop_piece' }),
  kick: (playerId: string) => send({ type: 'remove_player', playerId }),
  assignTrack: (playerId: string, trackId: string | null) => send({ type: 'assign_track', playerId, trackId }),
  setDynamics: (level: DynamicsLevel) => send({ type: 'set_dynamics', level }),
  setSection: (trackId: string, muted: boolean) => send({ type: 'set_section', trackId, muted }),
  dj: (cue: DjCue) => send({ type: 'dj', cue }),

  /** Slider drags fire constantly; send at most ~5 per second, always ending on the last value. */
  setTempo(bpm: number) {
    pendingBpm = bpm;
    if (throttledTempo) return;
    const flush = () => {
      throttledTempo = null;
      if (pendingBpm === null) return;
      send({ type: 'set_tempo', bpm: pendingBpm });
      pendingBpm = null;
      throttledTempo = setTimeout(flush, 200);
    };
    flush();
  },

  /** Play my next note. Runs inside the pointer handler: audio first, network fire-and-forget, then the store. */
  tap(): TapResult {
    unlockAudio();
    const s = store.state;
    const track = myTrack(s);
    const piece = s.piece;
    if (s.snapshot?.phase === 'playing' && track && isMuted(s, track.id)) return { played: false, resting: true, judgement: null };
    if (dj.loop && track && piece) {
      const { notes } = dj.loop;
      const index = notes[dj.loop.next % Math.max(1, notes.length)];
      const ev = index === undefined ? undefined : track.events[index];
      if (ev?.kind === 'note') {
        dj.loop.next++;
        playSafely(track.instrument, ev.midi, ev.beats, currentGrid()?.bpm ?? piece.bpm, ev.velocity, { level: levelNow(s) });
        navigator.vibrate?.(HAPTIC_NOTE);
        return { played: true, resting: false, judgement: null };
      }
    }
    const at = track ? skipRests(track.events, s.cursor) : 0;
    const ev = track?.events[at];
    if (s.snapshot?.phase !== 'playing' || !track || !piece || ev?.kind !== 'note') {
      thunk();
      navigator.vibrate?.(HAPTIC_DUD);
      return { played: false, resting: false, judgement: null };
    }
    if (!silentNow()) playSafely(track.instrument, ev.midi, ev.beats, currentGrid()?.bpm ?? piece.bpm, ev.velocity, { level: levelNow(s) });
    // Fire-and-forget: the note already sounded locally, a dropped echo is fine.
    net.send({ type: 'note_played', noteIndex: at });
    navigator.vibrate?.(HAPTIC_NOTE);
    const offset = offsetNow(track, at);
    const judgement: Judgement | null = offset === null ? null : judge(offset);
    store.set({ cursor: advanceCursor(track.events, at), ...(judgement ? { tally: record(s.tally, judgement) } : {}) });
    return { played: true, resting: false, judgement };
  },

  /** Shared clock and beat grid for the current run (null outside a run) */
  rhythm: (): RhythmView | null => {
    const g = currentGrid();
    return g ? { grid: g, clock } : null;
  },

  setAssist: (on: boolean) => store.set({ assist: on }),

  leave() {
    const conductor = store.state.session?.role === 'conductor';
    if (conductor && !confirm('Close the room for everyone?')) return;
    leaveToHome(null);
  },
};

export type Actions = typeof actions;

export function connect(): void {
  net.connect();
}
