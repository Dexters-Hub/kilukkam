import { PIECES, type ClientMessage, type DjCue, type DynamicsLevel, type RoomSnapshot, type ServerMessage, type Track } from '@kilukkam/shared';
import { CONDUCTOR_AVATAR } from '../data/composers.js';
import { playNote, preloadInstrument, thunk, unlockAudio } from '../lib/audio.js';
import { ServerClock } from '../lib/clock.js';
import { Net, wsUrl } from '../lib/net.js';
import { BeatGrid, HOLD_RELEASE_MS, WINDOWS, breakCombo, emptyTally, flickJudgement, judge, onsets, record, regrade, releaseJudgement, type Judgement } from '../lib/rhythm.js';
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
import { PLAYALONG_ID } from '../lib/spotify/playalong.js';
import { type PlayAlongChoice, choose, chosenPlayAlong, scoreFor, startSong, stopSong } from './playalong.js';

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

/** A paused room's grid: a segment so slow it stands still on `beat` (BeatGrid has no pause of its own). */
const frozen = (p: { at: number; beat: number }) => ({ bpm: 1e-9, at: p.at, beat: p.beat });

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
    // Arriving while the conductor holds the room paused: the grid stands still.
    const paused = store.state.snapshot?.paused;
    if (paused) g.anchor(frozen(paused));
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

// ---------- the end of the piece ----------

/** After the last beat of the longest part, how long the room rings out before results */
const RING_OUT_MS = 1800;
let finishTimer: ReturnType<typeof setInterval> | null = null;

/** Beats in the longest part: the piece is over once the room's grid passes it. */
const pieceBeats = (): number => Math.max(0, ...(store.state.piece?.tracks ?? []).map((t) => t.events.reduce((n, e) => n + e.beats, 0)));

/**
 * The conductor's laptop ends the run when the music has run out, so every
 * phone lands on its results without anyone pressing Stop. It re-reads the
 * grid each check, so tempo changes move the finish with them.
 */
function watchFinish(): void {
  stopFinishWatch();
  if (store.state.session?.role !== 'conductor') return;
  finishTimer = setInterval(() => {
    const g = currentGrid();
    const s = store.state;
    if (!g || s.snapshot?.phase !== 'playing') return stopFinishWatch();
    if (dj.loop || s.snapshot.paused) return;
    if (clock.now() > g.timeOf(pieceBeats()) + RING_OUT_MS) {
      stopFinishWatch();
      send({ type: 'stop_piece' });
    }
  }, 400);
}

function stopFinishWatch(): void {
  if (finishTimer) clearInterval(finishTimer);
  finishTimer = null;
}

/** The conductor's room is playing the Spotify play-along score it chose */
const playAlongActive = (): boolean => {
  const s = store.state;
  return s.session?.role === 'conductor' && chosenPlayAlong() !== null && s.snapshot?.customPiece === true && s.piece?.id === PLAYALONG_ID;
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
    stopSong();
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
      // A Spotify play-along swaps the placeholder piece for its own score straight away.
      {
        const pick = chosenPlayAlong();
        if (pick) net.send({ type: 'set_custom_piece', score: scoreFor(pick) });
      }
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
      if (playAlongActive()) void startSong(clock.toLocal(msg.startedAt));
      watchFinish();
      return;

    case 'piece_stopped':
      stopFinishWatch();
      if (s.session?.role === 'conductor') stopSong();
      return; // room_state carries the phase change

    case 'piece_paused':
      // The whole room stops on the same beat; nothing plays or counts as missed until it resumes.
      currentGrid()?.anchor(frozen(msg));
      emitLive('paused', { at: msg.at, beat: msg.beat });
      return;

    case 'piece_resumed':
      // Beat `beat` falls on `at`, after a short count-in; the frozen stretch before it stays frozen.
      currentGrid()?.anchor({ bpm: msg.bpm, at: msg.at, beat: msg.beat });
      emitLive('resumed', { at: msg.at, bpm: msg.bpm });
      return;

    case 'kilukkam':
      emitLive('kilukkam', { at: msg.at });
      return;

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
  if (s.session?.role === 'conductor' && s.snapshot?.phase === 'playing' && snap.phase !== 'playing') stopSong();
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
  stopSong();
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
  if (s.snapshot.paused) return;
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
  /** Lanes: the lane of the note this tap was judged against (null in single-lane play) */
  lane: number | null;
  /** Lanes: the tap hit another lane. The note counts as a miss, the combo breaks, the cursor stays. */
  wrongLane: boolean;
  /** Index in my part of the note this tap played (null when nothing played) */
  index: number | null;
}

/** Lane input for a tap; leave it out for single-lane play */
export interface TapHands {
  /** Lane of every event in my part (null for rests) */
  lanes: readonly (number | null)[];
  /** The lane the player hit */
  hit: number;
  /** ms since the finger came down (a flick note waits to see the swipe) */
  lateMs?: number;
  /** Expert: which events are flick notes */
  flicks?: readonly boolean[];
  /** The player flicked (swiped up, or Shift with the lane key) */
  flicked?: boolean;
}

/** The note a wrong-lane tap already cost: it scores a miss whenever it resolves, once */
let lostNote: { run: number | null; track: string; index: number } | null = null;

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
    choose(null);
    store.set({ intent: { kind: 'create', pieceId }, notice: null });
    if (net.isOpen) sendIntent();
  },

  /** Open a room for a Spotify play-along: any library piece holds the room until the play-along score replaces it. */
  openPlayAlong(pick: PlayAlongChoice) {
    const holder = PIECES[0]?.id;
    if (!holder) return;
    stopSong();
    actions.createRoom(holder);
    choose(pick);
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
  pausePiece: () => send({ type: 'pause_piece' }),
  resumePiece: () => send({ type: 'resume_piece' }),
  kilukkam: () => send({ type: 'kilukkam' }),
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
  tap(hands?: TapHands): TapResult {
    unlockAudio();
    const s = store.state;
    const track = myTrack(s);
    const piece = s.piece;
    if (s.snapshot?.phase === 'playing' && s.snapshot.paused) return { played: false, resting: true, judgement: null, lane: null, wrongLane: false, index: null };
    if (s.snapshot?.phase === 'playing' && track && isMuted(s, track.id)) return { played: false, resting: true, judgement: null, lane: null, wrongLane: false, index: null };
    if (dj.loop && track && piece) {
      const { notes } = dj.loop;
      const index = notes[dj.loop.next % Math.max(1, notes.length)];
      const ev = index === undefined ? undefined : track.events[index];
      if (ev?.kind === 'note') {
        dj.loop.next++;
        playSafely(track.instrument, ev.midi, ev.beats, currentGrid()?.bpm ?? piece.bpm, ev.velocity, { level: levelNow(s) });
        navigator.vibrate?.(HAPTIC_NOTE);
        return { played: true, resting: false, judgement: null, lane: null, wrongLane: false, index: null };
      }
    }
    const at = track ? skipRests(track.events, s.cursor) : 0;
    const ev = track?.events[at];
    if (s.snapshot?.phase !== 'playing' || !track || !piece || ev?.kind !== 'note') {
      thunk();
      navigator.vibrate?.(HAPTIC_DUD);
      return { played: false, resting: false, judgement: null, lane: null, wrongLane: false, index: null };
    }
    const lane = hands?.lanes[at] ?? null;
    const lost = lostNote?.run === runStartedAt && lostNote.track === track.id && lostNote.index === at;
    if (hands && lane !== null && hands.hit !== lane) {
      // Wrong lane: a soft thunk instead of the note, nothing sent, the cursor waits for the right hand.
      thunk();
      navigator.vibrate?.(HAPTIC_DUD);
      lostNote = { run: runStartedAt, track: track.id, index: at };
      if (s.tally.combo) store.set({ tally: breakCombo(s.tally) });
      return { played: false, resting: false, judgement: 'miss', lane, wrongLane: true, index: null };
    }
    if (lost) lostNote = null;
    if (!silentNow()) playSafely(track.instrument, ev.midi, ev.beats, currentGrid()?.bpm ?? piece.bpm, ev.velocity, { level: levelNow(s) });
    // Fire-and-forget: the note already sounded locally, a dropped echo is fine.
    net.send({ type: 'note_played', noteIndex: at });
    navigator.vibrate?.(HAPTIC_NOTE);
    const offset = offsetNow(track, at);
    const judged: Judgement | null = offset === null ? null : judge(offset - (hands?.lateMs ?? 0));
    const timed = judged && hands?.flicks?.[at] ? flickJudgement(judged, !!hands.flicked) : judged;
    const judgement: Judgement | null = lost && timed ? 'miss' : timed;
    store.set({ cursor: advanceCursor(track.events, at), ...(judgement ? { tally: record(s.tally, judgement) } : {}) });
    return { played: true, resting: false, judgement, lane, wrongLane: false, index: at };
  },

  /**
   * A hold note's finger lifted `earlyMs` before its tail ended (`holdMs` long).
   * Its head was already scored as `hit`; letting go too early rescores it
   * lower and breaks the combo. Nothing is sent: the note was played on the hit.
   */
  releaseHold(hit: Judgement, earlyMs: number, holdMs: number): Judgement {
    const to = releaseJudgement(hit, earlyMs, holdMs);
    if (earlyMs > HOLD_RELEASE_MS) store.set({ tally: regrade(store.state.tally, hit, to) });
    return to;
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
