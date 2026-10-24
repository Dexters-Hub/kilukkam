import {
  CODE_ALPHABET,
  CODE_LEN,
  MAX_NAME_LEN,
  getPiece,
  type ErrorCode,
  type NoteEvent,
  type PlayerSnapshot,
  type RoomSnapshot,
  type Score,
  type ScoreEvent,
  type Track,
} from '@kilukkam/shared';

// Client state. The last server snapshot is the truth about the room;
// the only thing the client owns is its cursor into its own track.

// ---------- pure helpers (unit tested) ----------

/** First index >= `from` that is a note, or events.length when none remain. */
export function skipRests(events: readonly ScoreEvent[], from: number): number {
  let i = Math.max(0, from);
  while (i < events.length && events[i]?.kind === 'rest') i++;
  return i;
}

/** Cursor after playing the note at `cursor`: past it and past any rests that follow. */
export function advanceCursor(events: readonly ScoreEvent[], cursor: number): number {
  const at = skipRests(events, cursor);
  return at >= events.length ? events.length : skipRests(events, at + 1);
}

export interface WindowNote {
  index: number;
  note: NoteEvent;
  /** Beats of rest immediately before this note (a "wait" cue) */
  restBefore: number;
}

/** The current note plus the next `count - 1`, rests folded into `restBefore`. */
export function nextEvents(events: readonly ScoreEvent[], cursor: number, count = 3): WindowNote[] {
  const out: WindowNote[] = [];
  let rest = 0;
  for (let i = Math.max(0, cursor); i < events.length && out.length < count; i++) {
    const e = events[i];
    if (!e) break;
    if (e.kind === 'rest') {
      rest += e.beats;
      continue;
    }
    out.push({ index: i, note: e, restBefore: rest });
    rest = 0;
  }
  return out;
}

/** Fraction of the track's notes already played, 0..1. */
export function progress(events: readonly ScoreEvent[], cursor: number): number {
  if (events.length === 0) return 0;
  return Math.min(1, Math.max(0, cursor) / events.length);
}

/** Room code as typed: uppercase, only alphabet chars, at most CODE_LEN. */
export function normalizeCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LEN) break;
  }
  return out;
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LEN && normalizeCode(code) === code;
}

/** Trimmed, single-spaced, capped at MAX_NAME_LEN UTF-16 units without splitting a glyph pair. */
export function normalizeName(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  let out = '';
  for (const ch of clean) {
    if (out.length + ch.length > MAX_NAME_LEN) break;
    out += ch;
  }
  return out.trimEnd();
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  room_not_found: "No room with that code. Check the conductor's screen.",
  room_full: 'That room is full: 100 players already.',
  invalid_name: 'Pick a name up to 20 characters.',
  invalid_avatar: 'Pick a composer to play as.',
  not_conductor: 'Only the conductor can do that.',
  not_in_room: 'You are not in a room yet.',
  track_full: 'That instrument is full. Try another, or Surprise me.',
  track_not_found: 'That instrument is no longer in this piece.',
  already_started: 'The piece has already started.',
  not_started: 'The piece has not started yet.',
  bad_message: 'Something went wrong. Try again.',
  unknown_piece: 'That piece is not in the library.',
};

export function errorText(code: string, fallback: string): string {
  return (ERROR_TEXT as Record<string, string | undefined>)[code] ?? fallback;
}

export function playersByTrack(players: readonly PlayerSnapshot[]): Map<string | null, PlayerSnapshot[]> {
  const map = new Map<string | null, PlayerSnapshot[]>();
  for (const p of players) {
    if (p.conductor) continue;
    const list = map.get(p.trackId) ?? [];
    list.push(p);
    map.set(p.trackId, list);
  }
  return map;
}

/**
 * Player ids to bump for one ensemble_pulse: one dot per tap on that track,
 * distinct, capped by the dots on screen and by `cap` so a busy section reads
 * as a shimmer rather than every dot jumping at once.
 */
export function pulseBumps(
  counts: Readonly<Record<string, number>>,
  idsByTrack: ReadonlyMap<string, readonly string[]>,
  cap: number,
  rand: () => number = Math.random,
): string[] {
  const out: string[] = [];
  for (const [trackId, n] of Object.entries(counts)) {
    const pool = [...(idsByTrack.get(trackId) ?? [])];
    const k = Math.min(n, pool.length, cap);
    for (let i = 0; i < k; i++) {
      const j = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
      out.push(...pool.splice(j, 1));
    }
  }
  return out;
}

export interface RejoinPlan {
  /** Track to claim again on the fresh socket */
  pick: string | null;
  /** Keep this cursor when we dropped and came back during the same run */
  resumeCursor: number | null;
}

/** After a dropped player is re-admitted: picks are open in every phase, so always reclaim the seat. */
export function rejoinPlan(
  snap: RoomSnapshot,
  session: Session,
  runStartedAt: number | null,
  cursor: number,
): RejoinPlan {
  const pick = session.trackId;
  const sameRun = snap.phase === 'playing' && snap.startedAt !== null && snap.startedAt === runStartedAt;
  return { pick, resumeCursor: pick && sameRun ? cursor : null };
}

// ---------- store ----------

export type Route = 'home' | 'create' | 'join';
export type Role = 'conductor' | 'player';
export type ConnStatus = 'connecting' | 'open' | 'reconnecting';

/** What we are in the middle of asking the server for */
export type Intent =
  | { kind: 'create'; pieceId: string }
  | { kind: 'join'; code: string; name: string; avatar: string };

/** How to get back in after a dropped socket */
export interface Session {
  role: Role;
  code: string;
  name: string;
  avatar: string;
  /** Last claimed track, re-picked after a rejoin (any phase) */
  trackId: string | null;
}

export interface AppState {
  route: Route;
  conn: ConnStatus;
  intent: Intent | null;
  session: Session | null;
  playerId: string | null;
  snapshot: RoomSnapshot | null;
  piece: Score | null;
  cursor: number;
  /** Shown on the join/home screen after being kicked or the room closing */
  notice: string | null;
  /** Code to prefill on the join screen */
  joinCode: string;
  /** Notes the whole room played in the run that just ended (summed from ensemble_pulse) */
  runNotes: number | null;
}

export function initialState(): AppState {
  return {
    route: 'home',
    conn: 'connecting',
    intent: null,
    session: null,
    playerId: null,
    snapshot: null,
    piece: null,
    cursor: 0,
    notice: null,
    joinCode: '',
    runNotes: null,
  };
}

export type ScreenKey = Route | 'lobby' | 'play' | 'stage' | 'ended';

export function screenKey(s: AppState): ScreenKey {
  if (!s.snapshot || !s.session) return s.route;
  switch (s.snapshot.phase) {
    case 'lobby':
      return 'lobby';
    case 'playing':
      return s.session.role === 'conductor' ? 'stage' : 'play';
    case 'ended':
      return 'ended';
  }
}

export function me(s: AppState): PlayerSnapshot | undefined {
  return s.snapshot?.players.find((p) => p.id === s.playerId);
}

export function myTrack(s: AppState): Track | undefined {
  const id = me(s)?.trackId;
  return id ? s.piece?.tracks.find((t) => t.id === id) : undefined;
}

/** Score for the room's current piece; `set_piece` only sends an id, so fall back to the shared library. */
export function resolvePiece(current: Score | null, pieceId: string): Score | null {
  if (current?.id === pieceId) return current;
  return getPiece(pieceId) ?? null;
}

type Listener = (s: AppState) => void;

export class Store {
  private s: AppState = initialState();
  private listeners = new Set<Listener>();

  get state(): AppState {
    return this.s;
  }

  set(patch: Partial<AppState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
