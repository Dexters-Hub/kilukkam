import type { Score } from './score.js';

export const PROTOCOL_VERSION = 1;

/** Room capacity: a full-room ensemble */
export const MAX_PLAYERS = 100;
export const CODE_LEN = 4;
export const MAX_NAME_LEN = 20;
/** Composer avatar ids (e.g. 'beethoven', 'tchaikovsky') or a short emoji */
export const MAX_AVATAR_LEN = 24;
/** Unambiguous alphabet: no 0/O, 1/I */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export const MIN_BPM = 40;
export const MAX_BPM = 200;
/** Default lead-in before a scheduled start, in ms */
export const COUNT_IN_MS = 3000;

export type DjCue = 'drop' | 'build' | 'loop_on' | 'loop_off';
const DJ_CUES: readonly DjCue[] = ['drop', 'build', 'loop_on', 'loop_off'];

/** Room tempo anchor: beat `beat` falls on server time `at`, then `bpm` from there */
export interface TempoAnchor {
  bpm: number;
  at: number;
  beat: number;
}

/** The room is paused: its grid stands still on `beat` (frozen at server time `at`) until resumed at `bpm` */
export interface PauseState {
  at: number;
  beat: number;
  bpm: number;
}

/** Beats the room counts in before it plays again after a pause */
export const RESUME_COUNT_IN_BEATS = 2;

/** Kilukkam, the room-wide bell: the server rings it at most once in this long */
export const KILUKKAM_COOLDOWN_MS = 3000;

/** Limits for conductor-uploaded custom scores; enforced server-side, mirrored by the importer */
export const CUSTOM_PIECE_LIMITS: Readonly<{
  maxTracks: number; maxEventsPerTrack: number; maxTitleLen: number; maxFrameBytes: number;
}> = { maxTracks: 8, maxEventsPerTrack: 2000, maxTitleLen: 80, maxFrameBytes: 256 * 1024 };

/** How long the server waits for player tallies after a stop before emitting piece_results */
export const RESULTS_GRACE_MS = 1500;

/** One phone's self-reported timing tally for a run */
export interface PlayerTally {
  perfect: number;
  great: number;
  good: number;
  miss: number;
  streakBest: number;
}

export interface SectionResult extends PlayerTally {
  trackId: string;
  players: number;
  /** (perfect + great + good) / total, 0..1; 0 when no notes */
  accuracy: number;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface PieceResults {
  sections: SectionResult[];
  room: { notes: number; accuracy: number; grade: Grade };
}

// ---------- room games (docs/specs/room-games.md) ----------

export type GameMode = 'thaalam' | 'echo' | 'tempo';
export type GameLevel = 'easy' | 'medium' | 'hard';
export type GamePhase = 'listen' | 'guess' | 'reveal' | 'done';
export type GameTile = 'green' | 'amber' | 'teal' | 'grey';
export type GameHint = 'replay' | 'era' | 'first_interval';
export const GAME_TRIES = 6;

/** One slot of the current guess: which phone (track) holds it and what was tapped */
export interface GameSlot {
  midi: number | null;
  playerId: string | null;
}

export interface GameRow {
  guess: number[];
  tiles: GameTile[];
}

export interface GameState {
  mode: GameMode;
  level: GameLevel;
  seed: string;
  phase: GamePhase;
  round: number;
  triesLeft: number;
  slots: GameSlot[];
  rows: GameRow[];
  /** Which midi each seated player holds in this game (thaalam/echo) */
  notes: Record<string, number>;
  /** Filled at reveal/done */
  answer: number[] | null;
  song: { title: string; by: string; genre: string } | null;
}

export interface GameResult {
  score: number;
  solved: boolean;
  grid: string;
  bonusAvailable: boolean;
}

/** Conductor expression level */
export type DynamicsLevel = 'pp' | 'p' | 'mf' | 'f' | 'ff';
const DYNAMICS_LEVELS: readonly DynamicsLevel[] = ['pp', 'p', 'mf', 'f', 'ff'];

export interface PlayerSnapshot {
  id: string;
  name: string;
  avatar: string;
  trackId: string | null;
  connected: boolean;
  conductor: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  pieceId: string;
  players: PlayerSnapshot[];
  maxPlayers: number;
  /** Server ms timestamp of last start; null while in lobby */
  startedAt: number | null;
  /** Current conductor expression level (default 'mf') */
  dynamics: DynamicsLevel;
  /** Tracks silenced by the conductor */
  mutedTracks: string[];
  /** True when the piece is a conductor-uploaded custom score, not a library piece */
  customPiece: boolean;
  /** Room tempo; null means use the piece's bpm from startedAt */
  tempo: TempoAnchor | null;
  /** Set while the conductor holds the room paused; null while it plays */
  paused: PauseState | null;
}

export type ClientMessage =
  | { type: 'create_room'; pieceId: string }
  | { type: 'join_room'; code: string; name: string; avatar: string }
  | { type: 'pick_track'; trackId: string }
  | { type: 'auto_assign' }
  | { type: 'set_piece'; pieceId: string }
  | { type: 'set_custom_piece'; score: Score }
  | { type: 'start_piece'; countIn?: boolean }
  | { type: 'stop_piece' }
  | { type: 'pause_piece' }
  | { type: 'resume_piece' }
  | { type: 'kilukkam' }
  | { type: 'set_tempo'; bpm: number }
  | { type: 'assign_track'; playerId: string; trackId: string | null }
  | { type: 'dj'; cue: DjCue; bars?: number }
  | { type: 'remove_player'; playerId: string }
  | { type: 'set_dynamics'; level: DynamicsLevel }
  | { type: 'set_section'; trackId: string; muted: boolean }
  | { type: 'note_played'; noteIndex: number }
  | { type: 'player_tally'; tally: PlayerTally }
  | { type: 'start_game'; mode: GameMode; seed?: string; level?: GameLevel }
  | { type: 'game_tap'; midi?: number; bpm?: number }
  | { type: 'game_hint'; kind: GameHint }
  | { type: 'game_answer'; song: string }
  | { type: 'end_game' }
  | { type: 'ping'; t: number };

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'invalid_name'
  | 'invalid_avatar'
  | 'not_conductor'
  | 'not_in_room'
  | 'track_full'
  | 'track_not_found'
  | 'already_started'
  | 'not_started'
  | 'bad_message'
  | 'unknown_piece';

export type ServerMessage =
  | { type: 'room_created'; code: string; playerId: string; snapshot: RoomSnapshot }
  | { type: 'joined'; playerId: string; snapshot: RoomSnapshot; piece: Score }
  | { type: 'room_state'; snapshot: RoomSnapshot }
  | { type: 'piece_changed'; piece: Score }
  | { type: 'piece_started'; startedAt: number; bpm: number }
  | { type: 'piece_stopped' }
  /** The grid freezes on `beat` from server time `at` */
  | { type: 'piece_paused'; at: number; beat: number }
  /** After a count-in, beat `beat` falls on server time `at`, then `bpm` from there */
  | { type: 'piece_resumed'; at: number; beat: number; bpm: number }
  /** The conductor rang the room: every phone flashes and chimes together */
  | { type: 'kilukkam'; at: number }
  | { type: 'piece_results'; results: PieceResults }
  | { type: 'game_state'; game: GameState }
  | { type: 'game_row'; row: GameRow; playback: { midi: number; playerIds: string[] }[] }
  | { type: 'game_result'; result: GameResult }
  | { type: 'game_ended' }
  | { type: 'tempo'; bpm: number; at: number; beat: number }
  | { type: 'dj'; cue: DjCue; at: number; bars?: number }
  | { type: 'dynamics'; level: DynamicsLevel }
  | { type: 'note_echo'; playerId: string; trackId: string; noteIndex: number }
  | {
      type: 'ensemble_pulse';
      /** Taps per track since the previous pulse (~4 Hz while playing) */
      counts: Record<string, number>;
      total: number;
      at: number;
    }
  | { type: 'room_closed'; reason: 'conductor_left' }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: ErrorCode; message: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown, max = 1024): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isCode(v: unknown): v is string {
  return isStr(v, CODE_LEN + 2);
}

function isPlayer(v: unknown): v is PlayerSnapshot {
  return (
    isObj(v) &&
    isStr(v.id, 64) &&
    isStr(v.name, MAX_NAME_LEN) &&
    isStr(v.avatar, MAX_AVATAR_LEN) &&
    (v.trackId === null || isStr(v.trackId, 64)) &&
    typeof v.connected === 'boolean' &&
    typeof v.conductor === 'boolean'
  );
}

function isSnapshot(v: unknown): v is RoomSnapshot {
  return (
    isObj(v) &&
    isCode(v.code) &&
    (v.phase === 'lobby' || v.phase === 'playing' || v.phase === 'ended') &&
    isStr(v.pieceId, 64) &&
    Array.isArray(v.players) &&
    v.players.every(isPlayer) &&
    typeof v.maxPlayers === 'number' &&
    (v.startedAt === null || typeof v.startedAt === 'number') &&
    (DYNAMICS_LEVELS as unknown[]).includes(v.dynamics) &&
    Array.isArray(v.mutedTracks) &&
    v.mutedTracks.every((t) => typeof t === 'string') &&
    typeof v.customPiece === 'boolean' &&
    (v.tempo === null || isTempo(v.tempo)) &&
    (v.paused === null || isPause(v.paused))
  );
}

const GAME_MODES: readonly GameMode[] = ['thaalam', 'echo', 'tempo'];
const GAME_LEVELS: readonly GameLevel[] = ['easy', 'medium', 'hard'];
const GAME_HINTS: readonly GameHint[] = ['replay', 'era', 'first_interval'];
const GAME_TILES: readonly GameTile[] = ['green', 'amber', 'teal', 'grey'];
const isMidi = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 127;
const isMidiArr = (v: unknown): v is number[] => Array.isArray(v) && v.every(isMidi);

function isGameRow(v: unknown): v is GameRow {
  return isObj(v) && isMidiArr(v.guess) && Array.isArray(v.tiles) &&
    v.tiles.every((t) => (GAME_TILES as unknown[]).includes(t));
}

function isGameState(v: unknown): v is GameState {
  return isObj(v) &&
    (GAME_MODES as unknown[]).includes(v.mode) &&
    (GAME_LEVELS as unknown[]).includes(v.level) &&
    isStr(v.seed, 64) &&
    ['listen', 'guess', 'reveal', 'done'].includes(v.phase as string) &&
    typeof v.round === 'number' && typeof v.triesLeft === 'number' &&
    Array.isArray(v.slots) && v.slots.every((sl) => isObj(sl) && (sl.midi === null || isMidi(sl.midi)) && (sl.playerId === null || typeof sl.playerId === 'string')) &&
    Array.isArray(v.rows) && v.rows.every(isGameRow) &&
    isObj(v.notes) && Object.values(v.notes).every(isMidi) &&
    (v.answer === null || isMidiArr(v.answer)) &&
    (v.song === null || (isObj(v.song) && typeof v.song.title === 'string' && typeof v.song.by === 'string' && typeof v.song.genre === 'string'));
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000;

function isTally(v: unknown): v is PlayerTally {
  return isObj(v) && isCount(v.perfect) && isCount(v.great) && isCount(v.good) && isCount(v.miss) && isCount(v.streakBest);
}

function isSection(v: unknown): v is SectionResult {
  return isObj(v) && isTally(v) && isStr(v.trackId, 64) && isCount(v.players) && typeof v.accuracy === 'number';
}

function isResults(v: unknown): v is PieceResults {
  if (!isObj(v) || !Array.isArray(v.sections) || !v.sections.every(isSection) || !isObj(v.room)) return false;
  const r = v.room;
  return isCount(r.notes) && typeof r.accuracy === 'number' && ['S', 'A', 'B', 'C', 'D'].includes(r.grade as string);
}

function isTempo(v: unknown): v is TempoAnchor {
  return (
    isObj(v) &&
    typeof v.bpm === 'number' && v.bpm >= MIN_BPM && v.bpm <= MAX_BPM &&
    typeof v.at === 'number' &&
    typeof v.beat === 'number'
  );
}

function isPause(v: unknown): v is PauseState {
  return isObj(v) && typeof v.at === 'number' && typeof v.beat === 'number' && typeof v.bpm === 'number' && v.bpm >= MIN_BPM && v.bpm <= MAX_BPM;
}

function isScore(v: unknown): v is Score {
  return (
    isObj(v) &&
    isStr(v.id, 64) &&
    typeof v.bpm === 'number' &&
    typeof v.beatsPerBar === 'number' &&
    Array.isArray(v.tracks)
  );
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.type !== 'string') return null;

  switch (v.type) {
    case 'create_room':
      return isStr(v.pieceId, 64) ? { type: 'create_room', pieceId: v.pieceId } : null;
    case 'join_room':
      return isCode(v.code) &&
        isStr(v.name, MAX_NAME_LEN) &&
        isStr(v.avatar, MAX_AVATAR_LEN)
        ? { type: 'join_room', code: v.code, name: v.name, avatar: v.avatar }
        : null;
    case 'pick_track':
      return isStr(v.trackId, 64) ? { type: 'pick_track', trackId: v.trackId } : null;
    case 'auto_assign':
      return { type: 'auto_assign' };
    case 'set_piece':
      return isStr(v.pieceId, 64) ? { type: 'set_piece', pieceId: v.pieceId } : null;
    case 'set_custom_piece':
      return isScore(v.score) ? { type: 'set_custom_piece', score: v.score } : null;
    case 'start_piece':
      return v.countIn === undefined
        ? { type: 'start_piece' }
        : typeof v.countIn === 'boolean' ? { type: 'start_piece', countIn: v.countIn } : null;
    case 'stop_piece':
      return { type: 'stop_piece' };
    case 'pause_piece':
      return { type: 'pause_piece' };
    case 'resume_piece':
      return { type: 'resume_piece' };
    case 'kilukkam':
      return { type: 'kilukkam' };
    case 'set_tempo':
      return typeof v.bpm === 'number' && v.bpm >= MIN_BPM && v.bpm <= MAX_BPM
        ? { type: 'set_tempo', bpm: v.bpm }
        : null;
    case 'assign_track':
      return isStr(v.playerId, 64) && (v.trackId === null || isStr(v.trackId, 64))
        ? { type: 'assign_track', playerId: v.playerId, trackId: v.trackId }
        : null;
    case 'dj': {
      if (!(DJ_CUES as unknown[]).includes(v.cue)) return null;
      const cue = v.cue as DjCue;
      if (v.bars === undefined) return { type: 'dj', cue };
      return typeof v.bars === 'number' && v.bars > 0 && v.bars <= 64
        ? { type: 'dj', cue, bars: v.bars }
        : null;
    }
    case 'remove_player':
      return isStr(v.playerId, 64) ? { type: 'remove_player', playerId: v.playerId } : null;
    case 'set_dynamics':
      return (DYNAMICS_LEVELS as unknown[]).includes(v.level)
        ? { type: 'set_dynamics', level: v.level as DynamicsLevel }
        : null;
    case 'set_section':
      return isStr(v.trackId, 64) && typeof v.muted === 'boolean'
        ? { type: 'set_section', trackId: v.trackId, muted: v.muted }
        : null;
    case 'player_tally':
      return isTally(v.tally) ? { type: 'player_tally', tally: v.tally } : null;
    case 'start_game': {
      if (!(GAME_MODES as unknown[]).includes(v.mode)) return null;
      const out: Extract<ClientMessage, { type: 'start_game' }> = { type: 'start_game', mode: v.mode as GameMode };
      if (v.seed !== undefined) { if (!isStr(v.seed, 64)) return null; out.seed = v.seed; }
      if (v.level !== undefined) { if (!(GAME_LEVELS as unknown[]).includes(v.level)) return null; out.level = v.level as GameLevel; }
      return out;
    }
    case 'game_tap': {
      const out: Extract<ClientMessage, { type: 'game_tap' }> = { type: 'game_tap' };
      if (v.midi !== undefined) { if (!isMidi(v.midi)) return null; out.midi = v.midi; }
      if (v.bpm !== undefined) { if (typeof v.bpm !== 'number' || v.bpm < 20 || v.bpm > 300) return null; out.bpm = v.bpm; }
      return out;
    }
    case 'game_hint':
      return (GAME_HINTS as unknown[]).includes(v.kind) ? { type: 'game_hint', kind: v.kind as GameHint } : null;
    case 'game_answer':
      return isStr(v.song, 120) ? { type: 'game_answer', song: v.song } : null;
    case 'end_game':
      return { type: 'end_game' };
    case 'note_played':
      return typeof v.noteIndex === 'number' && Number.isInteger(v.noteIndex) && v.noteIndex >= 0
        ? { type: 'note_played', noteIndex: v.noteIndex }
        : null;
    case 'ping':
      return typeof v.t === 'number' ? { type: 'ping', t: v.t } : null;
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.type !== 'string') return null;

  switch (v.type) {
    case 'room_created':
      return isCode(v.code) && isStr(v.playerId, 64) && isSnapshot(v.snapshot)
        ? { type: 'room_created', code: v.code, playerId: v.playerId, snapshot: v.snapshot }
        : null;
    case 'joined':
      return isStr(v.playerId, 64) && isSnapshot(v.snapshot) && isScore(v.piece)
        ? { type: 'joined', playerId: v.playerId, snapshot: v.snapshot, piece: v.piece }
        : null;
    case 'room_state':
      return isSnapshot(v.snapshot) ? { type: 'room_state', snapshot: v.snapshot } : null;
    case 'piece_changed':
      return isScore(v.piece) ? { type: 'piece_changed', piece: v.piece } : null;
    case 'piece_started':
      return typeof v.startedAt === 'number' && typeof v.bpm === 'number'
        ? { type: 'piece_started', startedAt: v.startedAt, bpm: v.bpm }
        : null;
    case 'piece_stopped':
      return { type: 'piece_stopped' };
    case 'piece_paused':
      return typeof v.at === 'number' && typeof v.beat === 'number'
        ? { type: 'piece_paused', at: v.at, beat: v.beat }
        : null;
    case 'kilukkam':
      return typeof v.at === 'number' ? { type: 'kilukkam', at: v.at } : null;
    case 'piece_resumed':
      return typeof v.at === 'number' && typeof v.beat === 'number' && typeof v.bpm === 'number' && v.bpm >= MIN_BPM && v.bpm <= MAX_BPM
        ? { type: 'piece_resumed', at: v.at, beat: v.beat, bpm: v.bpm }
        : null;
    case 'piece_results':
      return isResults(v.results) ? { type: 'piece_results', results: v.results } : null;
    case 'game_state':
      return isGameState(v.game) ? { type: 'game_state', game: v.game } : null;
    case 'game_row':
      return isGameRow(v.row) && Array.isArray(v.playback) &&
        v.playback.every((p) => isObj(p) && isMidi(p.midi) && Array.isArray(p.playerIds) && p.playerIds.every((x) => typeof x === 'string'))
        ? { type: 'game_row', row: v.row, playback: v.playback as { midi: number; playerIds: string[] }[] }
        : null;
    case 'game_result': {
      const r = v.result;
      return isObj(r) && typeof r.score === 'number' && typeof r.solved === 'boolean' &&
        typeof r.grid === 'string' && typeof r.bonusAvailable === 'boolean'
        ? { type: 'game_result', result: { score: r.score, solved: r.solved, grid: r.grid, bonusAvailable: r.bonusAvailable } }
        : null;
    }
    case 'game_ended':
      return { type: 'game_ended' };
    case 'tempo':
      return isTempo(v) ? { type: 'tempo', bpm: v.bpm, at: v.at, beat: v.beat } : null;
    case 'dj': {
      if (!(DJ_CUES as unknown[]).includes(v.cue) || typeof v.at !== 'number') return null;
      const cue = v.cue as DjCue;
      return v.bars === undefined
        ? { type: 'dj', cue, at: v.at }
        : typeof v.bars === 'number' ? { type: 'dj', cue, at: v.at, bars: v.bars } : null;
    }
    case 'dynamics':
      return (DYNAMICS_LEVELS as unknown[]).includes(v.level)
        ? { type: 'dynamics', level: v.level as DynamicsLevel }
        : null;
    case 'note_echo':
      return isStr(v.playerId, 64) && isStr(v.trackId, 64) &&
        typeof v.noteIndex === 'number'
        ? { type: 'note_echo', playerId: v.playerId, trackId: v.trackId, noteIndex: v.noteIndex }
        : null;
    case 'ensemble_pulse':
      return isObj(v.counts) &&
        Object.values(v.counts).every((n) => typeof n === 'number') &&
        typeof v.total === 'number' &&
        typeof v.at === 'number'
        ? {
            type: 'ensemble_pulse',
            counts: v.counts as Record<string, number>,
            total: v.total,
            at: v.at,
          }
        : null;
    case 'room_closed':
      return v.reason === 'conductor_left'
        ? { type: 'room_closed', reason: 'conductor_left' }
        : null;
    case 'pong':
      return typeof v.t === 'number' && typeof v.serverTime === 'number'
        ? { type: 'pong', t: v.t, serverTime: v.serverTime }
        : null;
    case 'error':
      return isStr(v.code, 64) && isStr(v.message, 256)
        ? { type: 'error', code: v.code as ErrorCode, message: v.message }
        : null;
    default:
      return null;
  }
}

export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
