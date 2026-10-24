import { describe, expect, it } from 'vitest';
import {
  GAME_TRIES,
  type ClientMessage,
  type ErrorCode,
  type GameState,
  type ServerMessage,
} from '@kilukkam/shared';
import { DAILY_POOL, fnv1a, judgeEcho, pickDaily, start as echoStart } from '@kilukkam/shared/games';
import { RoomEngine, type EngineAction } from '../src/room-engine.js';
import { TEMPO_WINDOW_MS, dealNotes, echoScale, notePool, pickPhrase, tempoBpm } from '../src/game-engine.js';

interface Harness {
  engine: RoomEngine;
  clock: { t: number };
  /** playerId -> socketId */
  sockets: Map<string, string>;
  players: string[];
}

const DAY = '2026-10-24';

/** A room with a conductor ('cond') and `n` players ('s1'..'sn'). */
function room(n: number): Harness {
  const clock = { t: Date.parse(`${DAY}T12:00:00Z`) };
  let id = 0;
  const engine = new RoomEngine({ now: () => clock.t, newId: () => `p${++id}` });
  const created = engine.handleMessage('cond', { type: 'create_room', pieceId: 'ode-to-joy' });
  const code = first(created, 'cond', 'room_created').code;
  const sockets = new Map<string, string>();
  const players: string[] = [];
  for (let i = 1; i <= n; i++) {
    const s = `s${i}`;
    const joined = engine.handleMessage(s, { type: 'join_room', code, name: s, avatar: '🎻' });
    const pid = first(joined, s, 'joined').playerId;
    sockets.set(pid, s);
    players.push(pid);
  }
  return { engine, clock, sockets, players };
}

function inbox(actions: EngineAction[], socketId: string): ServerMessage[] {
  return actions.flatMap((a) => (a.kind === 'send' && a.to.includes(socketId) ? [a.msg] : []));
}

function all<T extends ServerMessage['type']>(
  actions: EngineAction[],
  socketId: string,
  type: T,
): Extract<ServerMessage, { type: T }>[] {
  return inbox(actions, socketId).filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
}

function first<T extends ServerMessage['type']>(
  actions: EngineAction[],
  socketId: string,
  type: T,
): Extract<ServerMessage, { type: T }> {
  const msg = all(actions, socketId, type)[0];
  if (!msg) throw new Error(`no ${type} sent to ${socketId}: ${JSON.stringify(actions)}`);
  return msg;
}

function lastGame(actions: EngineAction[], socketId = 'cond'): GameState {
  const states = all(actions, socketId, 'game_state');
  const last = states[states.length - 1];
  if (!last) throw new Error(`no game_state sent to ${socketId}`);
  return last.game;
}

function errorCode(actions: EngineAction[], socketId: string): ErrorCode | undefined {
  const msg = inbox(actions, socketId).find((m) => m.type === 'error');
  return msg?.type === 'error' ? msg.code : undefined;
}

function send(h: Harness, socketId: string, msg: ClientMessage): EngineAction[] {
  return h.engine.handleMessage(socketId, msg);
}

/** Tap `midi` from the first phone that holds it as its primary note. */
function tap(h: Harness, game: GameState, midi: number): EngineAction[] {
  const pid = Object.keys(game.notes).find((p) => game.notes[p] === midi);
  if (!pid) throw new Error(`nobody holds ${midi}`);
  return send(h, h.sockets.get(pid)!, { type: 'game_tap', midi });
}

function guess(h: Harness, game: GameState, notes: readonly number[]): EngineAction[] {
  let actions: EngineAction[] = [];
  for (const m of notes) actions = tap(h, game, m);
  return actions;
}

/** A non-daily seed whose thaalam pick is `phraseId`. */
function seedFor(phraseId: string): string {
  for (let i = 0; i < 10_000; i++) {
    if (pickPhrase(`s${i}`).id === phraseId) return `s${i}`;
  }
  throw new Error(`no seed for ${phraseId}`);
}

/** Squares in a share grid (emoji are not one UTF-16 unit each). */
function squares(grid: string): number {
  return [...grid.replace(/\n/g, '')].length;
}

function startThaalam(h: Harness, seed?: string): GameState {
  const msg: ClientMessage = seed ? { type: 'start_game', mode: 'thaalam', seed } : { type: 'start_game', mode: 'thaalam' };
  return lastGame(send(h, 'cond', msg));
}

// Ode to Joy: [66, 66, 67, 69, 69], D major.
const ODE = [66, 66, 67, 69, 69];

describe('note pool and dealing', () => {
  it('pool holds every answer note plus scale fillers, sized by level', () => {
    const easy = notePool(ODE, 'D major', 'easy');
    expect(easy).toHaveLength(7);
    for (const m of ODE) expect(easy).toContain(m);
    // D major pitch classes only.
    for (const m of easy) expect([2, 4, 6, 7, 9, 11, 1]).toContain(m % 12);
    expect(notePool(ODE, 'D major', 'hard')).toHaveLength(12);
  });

  it('keeps chromatic answer notes outside the key', () => {
    // Fur Elise has D# in A minor.
    const pool = notePool([76, 75, 76, 75, 76], 'A minor', 'easy');
    expect(pool).toContain(75);
    expect(pool).toContain(76);
  });

  it('with fewer players than notes, every note is dealt and phones hold several', () => {
    const pool = [60, 62, 64, 65, 67, 69, 71];
    const held = dealNotes(pool, ['a', 'b', 'c']);
    expect(held.get('a')).toEqual([60, 65, 71]);
    expect(held.get('b')).toEqual([62, 67]);
    expect([...held.values()].flat().sort()).toEqual([...pool].sort());
  });

  it('with more players than notes, extra phones double up', () => {
    const held = dealNotes([60, 62], ['a', 'b', 'c']);
    expect(held.get('c')).toEqual([60]);
  });
});

describe('start_game', () => {
  it('assigns a note to every seated player and hides the answer', () => {
    const h = room(9);
    const actions = send(h, 'cond', { type: 'start_game', mode: 'thaalam' });
    const game = lastGame(actions, 's1');
    expect(game).toMatchObject({ mode: 'thaalam', level: 'easy', seed: DAY, phase: 'guess', triesLeft: GAME_TRIES, answer: null, song: null, rows: [] });
    expect(Object.keys(game.notes).sort()).toEqual([...h.players].sort());
    expect(game.slots).toEqual(Array.from({ length: 5 }, () => ({ midi: null, playerId: null })));
    // Every answer note is held by somebody.
    const answer = pickDaily(DAY, DAILY_POOL).midi;
    for (const m of answer) expect(Object.values(game.notes)).toContain(m);
  });

  it('defaults the seed to today and is deterministic', () => {
    const a = startThaalam(room(7));
    const b = startThaalam(room(7));
    expect(a.seed).toBe(DAY);
    expect(a.notes).toEqual(b.notes);
  });

  it('goes listen then guess, playing the answer through the phones that hold it', () => {
    const h = room(7);
    const actions = send(h, 'cond', { type: 'start_game', mode: 'thaalam' });
    const phases = all(actions, 'cond', 'game_state').map((m) => m.game.phase);
    expect(phases).toEqual(['listen', 'guess']);
    const row = first(actions, 's1', 'game_row');
    const answer = pickDaily(DAY, DAILY_POOL).midi;
    expect(row.row).toEqual({ guess: [], tiles: [] });
    expect(row.playback.map((p) => p.midi)).toEqual([...answer]);
    const game = lastGame(actions);
    for (const p of row.playback) {
      expect(p.playerIds.length).toBeGreaterThan(0);
      for (const id of p.playerIds) expect(game.notes[id]).toBe(p.midi);
    }
  });

  it('rejects a non-conductor', () => {
    const h = room(3);
    expect(errorCode(send(h, 's1', { type: 'start_game', mode: 'thaalam' }), 's1')).toBe('not_conductor');
  });

  it('rejects while a game is in progress or a piece is playing', () => {
    const h = room(3);
    startThaalam(h);
    expect(errorCode(send(h, 'cond', { type: 'start_game', mode: 'echo' }), 'cond')).toBe('already_started');

    const p = room(3);
    send(p, 'cond', { type: 'start_piece' });
    expect(errorCode(send(p, 'cond', { type: 'start_game', mode: 'thaalam' }), 'cond')).toBe('already_started');
  });

  it('rejects a room with no players', () => {
    const h = room(0);
    expect(errorCode(send(h, 'cond', { type: 'start_game', mode: 'thaalam' }), 'cond')).toBe('bad_message');
  });
});

describe('thaalam guesses', () => {
  it('fills slots in tap order', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    tap(h, game, 69);
    const state = lastGame(tap(h, game, 66));
    const p69 = Object.keys(game.notes).find((p) => game.notes[p] === 69);
    expect(state.slots[0]).toEqual({ midi: 69, playerId: p69 });
    expect(state.slots[1]!.midi).toBe(66);
    expect(state.slots[2]).toEqual({ midi: null, playerId: null });
  });

  it('rejects a note the player does not hold', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    const pid = h.players[0]!;
    const other = Object.values(game.notes).find((m) => m !== game.notes[pid])!;
    const actions = send(h, 's1', { type: 'game_tap', midi: other });
    expect(errorCode(actions, 's1')).toBe('bad_message');
  });

  it('a phone holding several notes may tap any of them', () => {
    const h = room(2);
    startThaalam(h, seedFor('ode-to-joy'));
    // Two phones share all seven notes, so each answer note is on one of them.
    for (const m of ODE) {
      const a = send(h, 's1', { type: 'game_tap', midi: m });
      if (errorCode(a, 's1')) expect(errorCode(send(h, 's2', { type: 'game_tap', midi: m }), 's2')).toBeUndefined();
    }
  });

  it('rejects taps from the conductor and when no game runs', () => {
    const h = room(2);
    expect(errorCode(send(h, 's1', { type: 'game_tap', midi: 60 }), 's1')).toBe('not_started');
    startThaalam(h);
    expect(errorCode(send(h, 'cond', { type: 'game_tap', midi: 60 }), 'cond')).toBe('bad_message');
  });

  it('judges a full row with duplicate notes the Wordle way and plays it back', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    // Three 69s against an answer with two: only two can colour.
    const actions = guess(h, game, [69, 69, 69, 66, 67]);
    const row = first(actions, 'cond', 'game_row');
    expect(row.row).toEqual({ guess: [69, 69, 69, 66, 67], tiles: ['amber', 'amber', 'grey', 'amber', 'amber'] });
    expect(row.playback.map((p) => p.midi)).toEqual([69, 69, 69, 66, 67]);
    const state = lastGame(actions);
    expect(state.triesLeft).toBe(GAME_TRIES - 1);
    expect(state.rows).toHaveLength(1);
    expect(state.slots.every((s) => s.midi === null)).toBe(true);
    expect(state.phase).toBe('guess');
  });

  it('solving reveals the song and sends a result with a share grid', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    guess(h, game, [69, 69, 69, 66, 67]);
    const actions = guess(h, game, ODE);
    const state = lastGame(actions);
    expect(state.phase).toBe('reveal');
    expect(state.answer).toEqual(ODE);
    expect(state.song).toEqual({ title: 'Ode to Joy (Symphony No. 9)', by: 'Ludwig van Beethoven', genre: 'classical' });
    const { result } = first(actions, 's3', 'game_result');
    expect(result.solved).toBe(true);
    expect(result.bonusAvailable).toBe(true);
    expect(squares(result.grid)).toBe(10);
    expect(result.grid.split('\n')).toHaveLength(2);
    // Row scores 6 + 12.5, plus (6 - 2 tries used) * 2.5.
    expect(result.score).toBe(6 + 12.5 + 10);
  });

  it('fails after six wrong rows and exposes the answer and song', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    let actions: EngineAction[] = [];
    for (let i = 0; i < GAME_TRIES; i++) actions = guess(h, game, [69, 69, 69, 69, 69]);
    const state = lastGame(actions);
    expect(state).toMatchObject({ phase: 'reveal', triesLeft: 0, answer: ODE });
    expect(state.song?.title).toBe('Ode to Joy (Symphony No. 9)');
    const { result } = first(actions, 'cond', 'game_result');
    expect(result).toMatchObject({ solved: false, bonusAvailable: false });
    expect(squares(result.grid)).toBe(30);
    const holder = h.sockets.get(Object.keys(game.notes).find((p) => game.notes[p] === 66)!)!;
    expect(errorCode(tap(h, game, 66), holder)).toBe('bad_message');
  });
});

describe('thaalam hints', () => {
  it('replay spends a try and plays the answer again', () => {
    const h = room(7);
    startThaalam(h, seedFor('ode-to-joy'));
    const actions = send(h, 'cond', { type: 'game_hint', kind: 'replay' });
    expect(first(actions, 's1', 'game_row').playback.map((p) => p.midi)).toEqual(ODE);
    expect(lastGame(actions).triesLeft).toBe(GAME_TRIES - 1);
    expect(lastGame(actions).answer).toBeNull();
  });

  it('first_interval plays the first two notes; era plays nothing', () => {
    const h = room(7);
    startThaalam(h, seedFor('ode-to-joy'));
    const fi = send(h, 'cond', { type: 'game_hint', kind: 'first_interval' });
    expect(first(fi, 'cond', 'game_row').playback.map((p) => p.midi)).toEqual([66, 66]);
    const era = send(h, 'cond', { type: 'game_hint', kind: 'era' });
    expect(first(era, 'cond', 'game_row')).toMatchObject({ row: { guess: [], tiles: [] }, playback: [] });
    expect(lastGame(era).triesLeft).toBe(GAME_TRIES - 2);
  });

  it('cannot be used on the last try, and only by the conductor', () => {
    const h = room(7);
    startThaalam(h, seedFor('ode-to-joy'));
    expect(errorCode(send(h, 's1', { type: 'game_hint', kind: 'replay' }), 's1')).toBe('not_conductor');
    for (let i = 0; i < GAME_TRIES - 1; i++) send(h, 'cond', { type: 'game_hint', kind: 'replay' });
    const actions = send(h, 'cond', { type: 'game_hint', kind: 'replay' });
    expect(errorCode(actions, 'cond')).toBe('bad_message');
  });

  it('hints count against the tries bonus', () => {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    send(h, 'cond', { type: 'game_hint', kind: 'replay' });
    const { result } = first(guess(h, game, ODE), 'cond', 'game_result');
    // 12.5 for the row, plus (6 - 2 tries used) * 2.5.
    expect(result.score).toBe(12.5 + 10);
    expect(squares(result.grid)).toBe(5);
  });
});

describe('game_answer bonus', () => {
  function solved(): { h: Harness; score: number } {
    const h = room(7);
    const game = startThaalam(h, seedFor('ode-to-joy'));
    const { result } = first(guess(h, game, ODE), 'cond', 'game_result');
    return { h, score: result.score };
  }

  it('a right answer from any player doubles the score once', () => {
    const { h, score } = solved();
    const actions = send(h, 's2', { type: 'game_answer', song: '  ode TO joy ' });
    expect(first(actions, 'cond', 'game_result').result).toMatchObject({ score: score * 2, bonusAvailable: false, solved: true });
    expect(errorCode(send(h, 's3', { type: 'game_answer', song: 'Ode to Joy' }), 's3')).toBe('bad_message');
  });

  it('accepts the full title too', () => {
    const { h, score } = solved();
    const actions = send(h, 's1', { type: 'game_answer', song: 'ode to joy (symphony no. 9)' });
    expect(first(actions, 'cond', 'game_result').result.score).toBe(score * 2);
  });

  it('a wrong answer spends the bonus without doubling', () => {
    const { h, score } = solved();
    const actions = send(h, 's1', { type: 'game_answer', song: 'Fur Elise' });
    expect(first(actions, 'cond', 'game_result').result).toMatchObject({ score, bonusAvailable: false });
  });

  it('is refused before the puzzle is solved', () => {
    const h = room(7);
    startThaalam(h, seedFor('ode-to-joy'));
    expect(errorCode(send(h, 's1', { type: 'game_answer', song: 'Ode to Joy' }), 's1')).toBe('bad_message');
  });
});

describe('end_game', () => {
  it('clears the game and returns everyone to the room', () => {
    const h = room(3);
    startThaalam(h);
    const actions = send(h, 'cond', { type: 'end_game' });
    expect(inbox(actions, 's1').map((m) => m.type)).toEqual(['game_ended', 'room_state']);
    expect(errorCode(send(h, 's1', { type: 'game_tap', midi: 60 }), 's1')).toBe('not_started');
    expect(lastGame(send(h, 'cond', { type: 'start_game', mode: 'thaalam' })).phase).toBe('guess');
  });

  it('is conductor only and needs a game', () => {
    const h = room(3);
    expect(errorCode(send(h, 'cond', { type: 'end_game' }), 'cond')).toBe('not_started');
    startThaalam(h);
    expect(errorCode(send(h, 's1', { type: 'end_game' }), 's1')).toBe('not_conductor');
  });

  it('starting a piece or changing it drops the game', () => {
    const h = room(3);
    startThaalam(h);
    send(h, 'cond', { type: 'start_piece' });
    expect(errorCode(send(h, 's1', { type: 'game_tap', midi: 60 }), 's1')).toBe('not_started');

    const p = room(3);
    startThaalam(p);
    send(p, 'cond', { type: 'set_piece', pieceId: 'ode-to-joy' });
    expect(errorCode(send(p, 's1', { type: 'game_tap', midi: 60 }), 's1')).toBe('not_started');
  });
});

describe('echo', () => {
  function startEcho(h: Harness): { game: GameState; sequence: number[] } {
    const actions = send(h, 'cond', { type: 'start_game', mode: 'echo', seed: 'echo-test' });
    const sequence = first(actions, 'cond', 'game_row').playback.map((p) => p.midi);
    return { game: lastGame(actions), sequence };
  }

  it('plays a one-note sequence first, from the room scale', () => {
    const h = room(7);
    const { game, sequence } = startEcho(h);
    expect(game).toMatchObject({ mode: 'echo', round: 1, phase: 'guess' });
    expect(sequence).toHaveLength(1);
    expect(Object.values(game.notes)).toContain(sequence[0]);
  });

  it('a clean repeat extends the sequence by one', () => {
    const h = room(7);
    const { game, sequence } = startEcho(h);
    const actions = guess(h, game, sequence);
    const next = first(actions, 'cond', 'game_row').playback.map((p) => p.midi);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(sequence[0]);
    expect(lastGame(actions)).toMatchObject({ round: 2, phase: 'guess' });
    expect(lastGame(actions).slots).toEqual([]);
  });

  it('a wrong tap ends the run with the longest clean chain as score', () => {
    const h = room(7);
    const { game, sequence } = startEcho(h);
    let actions = guess(h, game, sequence);
    const seq2 = first(actions, 'cond', 'game_row').playback.map((p) => p.midi);
    const wrong = Object.values(game.notes).find((m) => m !== seq2[0])!;
    actions = tap(h, game, wrong);
    const state = lastGame(actions);
    expect(state).toMatchObject({ phase: 'done', answer: seq2 });
    expect(first(actions, 'cond', 'game_result').result).toMatchObject({ score: 1, solved: false, grid: 'Echo 1' });
  });

  it('matches the shared echo generator for the same seed', () => {
    const h = room(7);
    const { game, sequence } = startEcho(h);
    const scale = echoScale('easy');
    expect([...new Set(Object.values(game.notes))].sort((a, b) => a - b)).toEqual(scale);
    const ref = echoStart(fnv1a('echo-test'), scale);
    expect(sequence).toEqual(ref.sequence);
    expect(judgeEcho(ref, sequence).ok).toBe(true);
  });
});

describe('tempo', () => {
  it('picks a bpm in 60..180 from the seed and carries it as the round', () => {
    const h = room(3);
    const game = lastGame(send(h, 'cond', { type: 'start_game', mode: 'tempo', seed: 'beat' }));
    expect(game.round).toBe(tempoBpm('beat'));
    expect(game.round).toBeGreaterThanOrEqual(60);
    expect(game.round).toBeLessThanOrEqual(180);
    expect(game.phase).toBe('guess');
  });

  it('judges the median once every seated player has tapped', () => {
    const h = room(3);
    const bpm = tempoBpm('beat');
    send(h, 'cond', { type: 'start_game', mode: 'tempo', seed: 'beat' });
    send(h, 's1', { type: 'game_tap', bpm: bpm + 1 });
    send(h, 's2', { type: 'game_tap', bpm: 299 });
    const actions = send(h, 's3', { type: 'game_tap', bpm });
    expect(lastGame(actions).phase).toBe('done');
    expect(first(actions, 'cond', 'game_result').result).toMatchObject({ solved: true, grid: 'Tempo perfect' });
  });

  it('closes the window on tick after 10 s with whatever came in', () => {
    const h = room(3);
    send(h, 'cond', { type: 'start_game', mode: 'tempo', seed: 'beat' });
    send(h, 's1', { type: 'game_tap', bpm: 20 });
    expect(all(h.engine.tick(h.clock.t + TEMPO_WINDOW_MS - 1), 'cond', 'game_result')).toEqual([]);
    const actions = h.engine.tick(h.clock.t + TEMPO_WINDOW_MS);
    expect(first(actions, 'cond', 'game_result').result).toMatchObject({ solved: false, score: 0, grid: 'Tempo miss' });
  });

  it('rejects a tempo tap without a bpm', () => {
    const h = room(3);
    send(h, 'cond', { type: 'start_game', mode: 'tempo' });
    expect(errorCode(send(h, 's1', { type: 'game_tap' }), 's1')).toBe('bad_message');
  });
});
