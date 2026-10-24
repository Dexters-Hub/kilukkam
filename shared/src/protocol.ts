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
  | { type: 'set_tempo'; bpm: number }
  | { type: 'assign_track'; playerId: string; trackId: string | null }
  | { type: 'dj'; cue: DjCue; bars?: number }
  | { type: 'remove_player'; playerId: string }
  | { type: 'set_dynamics'; level: DynamicsLevel }
  | { type: 'set_section'; trackId: string; muted: boolean }
  | { type: 'note_played'; noteIndex: number }
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
    (v.tempo === null || isTempo(v.tempo))
  );
}

function isTempo(v: unknown): v is TempoAnchor {
  return (
    isObj(v) &&
    typeof v.bpm === 'number' && v.bpm >= MIN_BPM && v.bpm <= MAX_BPM &&
    typeof v.at === 'number' &&
    typeof v.beat === 'number'
  );
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
