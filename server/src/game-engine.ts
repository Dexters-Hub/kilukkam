import {
  GAME_TRIES,
  type ClientMessage,
  type ErrorCode,
  type GameHint,
  type GameLevel,
  type GameMode,
  type GameResult,
  type GameRow,
  type GameState,
  type ServerMessage,
} from '@kilukkam/shared';
import {
  DAILY_POOL,
  ROW_LEN,
  extend,
  fnv1a,
  judgeEcho,
  judgeRow,
  judgeTempo,
  medianBpm,
  mulberry32,
  pickDaily,
  scoreRow,
  shareGrid,
  start as echoStart,
  type EchoState,
  type Phrase,
  type TempoGrade,
} from '@kilukkam/shared/games';

/**
 * Per-room game state machine (docs/specs/room-games.md). Pure: the room
 * engine passes in players and time, and broadcasts whatever comes back to
 * the whole room. The answer stays server-side until reveal.
 */
export interface GameSession {
  state: GameState;
  /** Thaalam phrase or the current echo sequence */
  answer: number[];
  phrase: Phrase | null;
  /** Every note each phone may tap; `state.notes` carries only the first */
  held: Map<string, number[]>;
  echo: EchoState | null;
  /** Tempo round: the target and each phone's latest tap */
  bpm: number | null;
  bpmTaps: Map<string, number>;
  closesAt: number | null;
  score: number;
  bonusAvailable: boolean;
}

export type GameStep =
  | { ok: true; out: ServerMessage[] }
  | { ok: false; code: ErrorCode; message: string };

export const TEMPO_WINDOW_MS = 10_000;
const MIN_TEMPO = 60;
const MAX_TEMPO = 180;
const POOL_SIZE: Readonly<Record<GameLevel, number>> = { easy: 7, medium: 9, hard: 12 };
const DATE_SEED = /^\d{4}-\d{2}-\d{2}$/;
const ECHO_BASE = 60;
const TEMPO_SCORE: Readonly<Record<TempoGrade, number>> = { perfect: 10, great: 7.5, good: 5, close: 2.5, miss: 0 };

const PITCH: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Daily seeds use the world's daily pick; any other seed is an endless round */
export function pickPhrase(seed: string): Phrase {
  if (DATE_SEED.test(seed)) return pickDaily(seed, DAILY_POOL);
  return DAILY_POOL[Math.floor(mulberry32(fnv1a(seed))() * DAILY_POOL.length)]!;
}

export function tempoBpm(seed: string): number {
  return MIN_TEMPO + Math.floor(mulberry32(fnv1a(seed))() * (MAX_TEMPO - MIN_TEMPO + 1));
}

/** Pitch classes of a key like 'F# minor'; unparseable keys fall back to C major */
function scaleOf(key: string, level: GameLevel): number[] {
  if (level === 'hard') return CHROMATIC;
  const m = /^([A-G])([#b]?)\s+(major|minor)$/.exec(key.trim());
  if (!m) return MAJOR;
  const tonic = PITCH[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (m[3] === 'minor' ? MINOR : MAJOR).map((i) => (tonic + i + 12) % 12);
}

/**
 * The notes the room plays: every distinct answer note (chromatic ones
 * too), filled out with the key's nearest scale notes around the answer's
 * median until the level's pool size.
 */
export function notePool(answer: readonly number[], key: string, level: GameLevel): number[] {
  const pool = [...new Set(answer)];
  const sorted = [...answer].sort((a, b) => a - b);
  const centre = sorted[Math.floor(sorted.length / 2)] ?? ECHO_BASE;
  const pcs = scaleOf(key, level);
  const fillers: number[] = [];
  for (let m = centre - 12; m <= centre + 12; m++) {
    if (m >= 0 && m <= 127 && pcs.includes(m % 12) && !pool.includes(m)) fillers.push(m);
  }
  fillers.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
  while (pool.length < POOL_SIZE[level] && fillers.length > 0) pool.push(fillers.shift()!);
  return pool.sort((a, b) => a - b);
}

/** Echo plays from a C major (hard: chromatic) ladder up from middle C */
export function echoScale(level: GameLevel): number[] {
  const pcs = scaleOf('C major', level);
  const out: number[] = [];
  for (let m = ECHO_BASE; out.length < POOL_SIZE[level]; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

/**
 * Round-robin: with more phones than notes, extra phones double up; with
 * fewer, a phone holds several notes. Either way every note is dealt.
 */
export function dealNotes(pool: readonly number[], players: readonly string[]): Map<string, number[]> {
  const held = new Map<string, number[]>(players.map((p) => [p, []]));
  if (players.length === 0 || pool.length === 0) return held;
  for (let j = 0; j < Math.max(players.length, pool.length); j++) {
    held.get(players[j % players.length]!)!.push(pool[j % pool.length]!);
  }
  return held;
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const rand = mulberry32(fnv1a(`${seed}:deal`));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function startGame(opts: {
  mode: GameMode;
  seed: string;
  level: GameLevel;
  players: readonly string[];
  now: number;
}): { session: GameSession; out: ServerMessage[] } {
  const { mode, seed, level, players, now } = opts;
  const phrase = mode === 'thaalam' ? pickPhrase(seed) : null;
  const echo = mode === 'echo' ? echoStart(fnv1a(seed), echoScale(level)) : null;
  const pool = phrase ? notePool(phrase.midi, phrase.key, level) : mode === 'echo' ? echoScale(level) : [];
  // Shuffled so join order does not hint which phones hold the answer.
  const held = dealNotes(shuffled(pool, seed), players);
  const notes: Record<string, number> = {};
  for (const [p, ms] of held) if (ms[0] !== undefined) notes[p] = ms[0];
  const bpm = mode === 'tempo' ? tempoBpm(seed) : null;

  const session: GameSession = {
    state: {
      mode,
      level,
      seed,
      phase: 'listen',
      round: bpm ?? 1,
      triesLeft: mode === 'thaalam' ? GAME_TRIES : 1,
      slots: mode === 'thaalam' ? emptySlots() : [],
      rows: [],
      notes,
      answer: null,
      song: null,
    },
    answer: phrase ? [...phrase.midi] : echo ? [...echo.sequence] : [],
    phrase,
    held,
    echo,
    bpm,
    bpmTaps: new Map(),
    closesAt: bpm === null ? null : now + TEMPO_WINDOW_MS,
    score: 0,
    bonusAvailable: false,
  };
  const out: ServerMessage[] = [stateMsg(session)];
  if (mode !== 'tempo') out.push(playbackMsg(session, session.answer));
  session.state.phase = 'guess';
  out.push(stateMsg(session));
  return { session, out };
}

export function gameTap(
  s: GameSession,
  playerId: string,
  msg: Extract<ClientMessage, { type: 'game_tap' }>,
  seated: readonly string[],
): GameStep {
  if (s.state.phase !== 'guess') return refuse('bad_message', 'not taking taps now');
  if (s.state.mode === 'tempo') {
    if (msg.bpm === undefined) return refuse('bad_message', 'tempo taps need a bpm');
    if (!seated.includes(playerId)) return refuse('bad_message', 'only players tap');
    s.bpmTaps.set(playerId, msg.bpm);
    if (seated.every((p) => s.bpmTaps.has(p))) return { ok: true, out: finishTempo(s) };
    return { ok: true, out: [] };
  }

  const mine = s.held.get(playerId) ?? [];
  const midi = msg.midi ?? mine[0];
  if (midi === undefined || !mine.includes(midi)) return refuse('bad_message', 'you do not hold that note');
  return { ok: true, out: s.state.mode === 'echo' ? echoTap(s, playerId, midi) : thaalamTap(s, playerId, midi) };
}

function thaalamTap(s: GameSession, playerId: string, midi: number): ServerMessage[] {
  const slot = s.state.slots.find((sl) => sl.midi === null)!;
  slot.midi = midi;
  slot.playerId = playerId;
  if (s.state.slots.some((sl) => sl.midi === null)) return [stateMsg(s)];

  const guess = s.state.slots.map((sl) => sl.midi!);
  const row: GameRow = { guess, tiles: judgeRow(guess, s.answer) };
  s.state.rows.push(row);
  s.state.triesLeft--;
  s.state.slots = emptySlots();
  const out: ServerMessage[] = [{ type: 'game_row', row, playback: playback(s, guess) }];

  const solved = row.tiles.every((t) => t === 'green');
  if (!solved && s.state.triesLeft > 0) return [...out, stateMsg(s)];

  const used = GAME_TRIES - s.state.triesLeft;
  s.score = s.state.rows.reduce((sum, r) => sum + scoreRow(r.tiles), 0) + (solved ? (GAME_TRIES - used) * 2.5 : 0);
  s.bonusAvailable = solved;
  reveal(s, 'reveal');
  return [...out, stateMsg(s), resultMsg(s, solved, shareGrid(s.state.rows.map((r) => r.tiles)))];
}

function echoTap(s: GameSession, playerId: string, midi: number): ServerMessage[] {
  const echo = s.echo!;
  s.state.slots.push({ midi, playerId });
  const taps = s.state.slots.map((sl) => sl.midi!);
  const i = taps.length - 1;
  if (taps[i] !== echo.sequence[i]) {
    s.score = echo.round - 1;
    reveal(s, 'done');
    return [stateMsg(s), resultMsg(s, false, `Echo ${s.score}`)];
  }
  if (taps.length < echo.sequence.length || !judgeEcho(echo, taps).ok) return [stateMsg(s)];

  s.echo = extend(echo);
  s.answer = [...s.echo.sequence];
  s.state.round = s.echo.round;
  s.state.slots = [];
  s.state.phase = 'listen';
  const out: ServerMessage[] = [stateMsg(s), playbackMsg(s, s.answer)];
  s.state.phase = 'guess';
  return [...out, stateMsg(s)];
}

function finishTempo(s: GameSession): ServerMessage[] {
  const median = medianBpm([...s.bpmTaps.values()]);
  const grade = median === null ? 'miss' : judgeTempo(median, s.bpm!);
  s.score = TEMPO_SCORE[grade];
  s.closesAt = null;
  s.state.phase = 'done';
  return [stateMsg(s), resultMsg(s, grade !== 'miss', `Tempo ${grade}`)];
}

/** The tempo round closes on its own after the tap window */
export function gameTick(s: GameSession, now: number): ServerMessage[] {
  if (s.closesAt === null || now < s.closesAt || s.state.phase !== 'guess') return [];
  return finishTempo(s);
}

/**
 * Every hint spends a try. The v1 contract has no field for hint text, so
 * era and first_interval go out as playback rows (first_interval: the
 * first two answer notes; era: no notes) until the contract grows one.
 */
export function gameHint(s: GameSession, kind: GameHint): GameStep {
  if (s.state.mode !== 'thaalam') return refuse('bad_message', 'hints are for thaalam');
  if (s.state.phase !== 'guess') return refuse('bad_message', 'not guessing now');
  if (s.state.triesLeft <= 1) return refuse('bad_message', 'no hints on the last try');
  s.state.triesLeft--;
  const notes = kind === 'replay' ? s.answer : kind === 'first_interval' ? s.answer.slice(0, 2) : [];
  return { ok: true, out: [playbackMsg(s, notes), stateMsg(s)] };
}

/** The bonus: one answer per solve, from any phone; right doubles the score */
export function gameAnswer(s: GameSession, song: string): GameStep {
  if (!s.phrase || s.state.phase !== 'reveal' || !s.bonusAvailable) {
    return refuse('bad_message', 'no bonus answer open');
  }
  s.bonusAvailable = false;
  const said = normalise(song);
  const title = s.phrase.song;
  if (said === normalise(title) || said === normalise(title.replace(/\(.*\)/, ''))) s.score *= 2;
  return { ok: true, out: [resultMsg(s, true, shareGrid(s.state.rows.map((r) => r.tiles)))] };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function reveal(s: GameSession, phase: 'reveal' | 'done'): void {
  s.state.phase = phase;
  s.state.answer = [...s.answer];
  if (s.phrase) {
    s.state.song = {
      title: s.phrase.song,
      by: s.phrase.composer ?? s.phrase.artist ?? '',
      genre: s.phrase.genre,
    };
  }
}

function emptySlots(): GameState['slots'] {
  return Array.from({ length: ROW_LEN }, () => ({ midi: null, playerId: null }));
}

/** Each note goes to every phone that holds it */
function playback(s: GameSession, notes: readonly number[]): { midi: number; playerIds: string[] }[] {
  return notes.map((midi) => ({
    midi,
    playerIds: [...s.held].filter(([, ms]) => ms.includes(midi)).map(([p]) => p),
  }));
}

/** A row that only plays notes: the listen phase and hints */
function playbackMsg(s: GameSession, notes: readonly number[]): ServerMessage {
  return { type: 'game_row', row: { guess: [], tiles: [] }, playback: playback(s, notes) };
}

/** Cloned: later moves must not rewrite messages already queued */
function stateMsg(s: GameSession): ServerMessage {
  return { type: 'game_state', game: structuredClone(s.state) };
}

function resultMsg(s: GameSession, solved: boolean, grid: string): ServerMessage {
  const result: GameResult = { score: s.score, solved, grid, bonusAvailable: s.bonusAvailable };
  return { type: 'game_result', result };
}

function refuse(code: ErrorCode, message: string): GameStep {
  return { ok: false, code, message };
}
