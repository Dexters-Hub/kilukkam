import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LEN,
  COUNT_IN_MS,
  MAX_PLAYERS,
  RESULTS_GRACE_MS,
  encodeMessage,
  getPiece,
  type ClientMessage,
  type ErrorCode,
  type RoomSnapshot,
  type ServerMessage,
} from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from '../src/room-engine.js';

interface Harness {
  engine: RoomEngine;
  clock: { t: number };
}

function setup(random?: () => number): Harness {
  const clock = { t: 1_000 };
  let n = 0;
  const engine = new RoomEngine({
    now: () => clock.t,
    newId: () => `p${++n}`,
    ...(random ? { random } : {}),
  });
  return { engine, clock };
}

/** Messages delivered to one socket by a batch of actions, in order. */
function inbox(actions: EngineAction[], socketId: string): ServerMessage[] {
  return actions.flatMap((a) => (a.kind === 'send' && a.to.includes(socketId) ? [a.msg] : []));
}

function only<T extends ServerMessage['type']>(
  actions: EngineAction[],
  socketId: string,
  type: T,
): Extract<ServerMessage, { type: T }> {
  const msg = inbox(actions, socketId).find((m) => m.type === type);
  if (!msg) throw new Error(`no ${type} sent to ${socketId}: ${JSON.stringify(actions)}`);
  return msg as Extract<ServerMessage, { type: T }>;
}

function errorCode(actions: EngineAction[], socketId: string): ErrorCode | undefined {
  const msg = inbox(actions, socketId).find((m) => m.type === 'error');
  return msg?.type === 'error' ? msg.code : undefined;
}

function lastSnapshot(actions: EngineAction[], socketId: string): RoomSnapshot {
  const states = inbox(actions, socketId).filter((m) => m.type === 'room_state');
  const last = states[states.length - 1];
  if (last?.type !== 'room_state') throw new Error(`no room_state sent to ${socketId}`);
  return last.snapshot;
}

function send(h: Harness, socketId: string, msg: ClientMessage): EngineAction[] {
  return h.engine.handleMessage(socketId, msg);
}

function createRoom(h: Harness, socketId = 'cond', pieceId = 'ode-to-joy'): string {
  return only(send(h, socketId, { type: 'create_room', pieceId }), socketId, 'room_created').code;
}

function joinRoom(h: Harness, socketId: string, code: string, name = socketId): string {
  const actions = send(h, socketId, { type: 'join_room', code, name, avatar: '🎻' });
  return only(actions, socketId, 'joined').playerId;
}

describe('create_room', () => {
  it('creates a lobby room with the creator as conductor', () => {
    const h = setup();
    const actions = send(h, 'cond', { type: 'create_room', pieceId: 'canon-in-d' });
    const msg = only(actions, 'cond', 'room_created');

    expect(msg.code).toHaveLength(CODE_LEN);
    for (const ch of msg.code) expect(CODE_ALPHABET).toContain(ch);
    expect(msg.snapshot).toMatchObject({
      code: msg.code,
      phase: 'lobby',
      pieceId: 'canon-in-d',
      maxPlayers: MAX_PLAYERS,
      startedAt: null,
    });
    expect(msg.snapshot.players).toEqual([
      expect.objectContaining({ id: msg.playerId, conductor: true, connected: true, trackId: null }),
    ]);
  });

  it('rejects an unknown piece', () => {
    const h = setup();
    const actions = send(h, 'cond', { type: 'create_room', pieceId: 'nope' });
    expect(errorCode(actions, 'cond')).toBe('unknown_piece');
    expect(h.engine.roomCount).toBe(0);
  });

  it('retries on code collision', () => {
    // First two codes are both "AAAA"; the third draw differs.
    const draws = [0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0, 0, 0];
    const h = setup(() => draws.shift() ?? 0.5);
    const a = createRoom(h, 'c1');
    const b = createRoom(h, 'c2');
    expect(a).toBe('AAAA');
    expect(b).not.toBe(a);
    expect(h.engine.roomCount).toBe(2);
  });

  it('rejects create_room from a socket already in a room', () => {
    const h = setup();
    createRoom(h);
    const actions = send(h, 'cond', { type: 'create_room', pieceId: 'ode-to-joy' });
    expect(errorCode(actions, 'cond')).toBe('bad_message');
    expect(h.engine.roomCount).toBe(1);
  });
});

describe('join_room', () => {
  it('joins case-insensitively and receives the full score', () => {
    const h = setup();
    const code = createRoom(h);
    const actions = send(h, 'p', {
      type: 'join_room',
      code: code.toLowerCase(),
      name: 'Asha',
      avatar: '🎻',
    });
    const joined = only(actions, 'p', 'joined');
    expect(joined.piece).toEqual(getPiece('ode-to-joy'));
    expect(joined.snapshot.code).toBe(code);
    expect(joined.snapshot.players).toContainEqual(
      expect.objectContaining({ id: joined.playerId, name: 'Asha', conductor: false, trackId: null }),
    );
    // Conductor sees the new player.
    expect(lastSnapshot(actions, 'cond').players).toHaveLength(2);
  });

  it('returns room_not_found for a bad code', () => {
    const h = setup();
    createRoom(h);
    const actions = send(h, 'p', { type: 'join_room', code: 'ZZZZ', name: 'x', avatar: 'y' });
    expect(errorCode(actions, 'p')).toBe('room_not_found');
  });

  it('rejects a blank name or avatar', () => {
    const h = setup();
    const code = createRoom(h);
    expect(
      errorCode(send(h, 'p', { type: 'join_room', code, name: '   ', avatar: '🎻' }), 'p'),
    ).toBe('invalid_name');
    expect(
      errorCode(send(h, 'p', { type: 'join_room', code, name: 'Asha', avatar: '  ' }), 'p'),
    ).toBe('invalid_avatar');
  });

  it('returns room_full once MAX_PLAYERS players have joined', () => {
    const h = setup();
    const code = createRoom(h);
    for (let i = 0; i < MAX_PLAYERS; i++) joinRoom(h, `s${i}`, code, `n${i}`);
    const actions = send(h, 'late', { type: 'join_room', code, name: 'late', avatar: '🎺' });
    expect(errorCode(actions, 'late')).toBe('room_full');
  });

  it('frees capacity when a player disconnects', () => {
    const h = setup();
    const code = createRoom(h);
    for (let i = 0; i < MAX_PLAYERS; i++) joinRoom(h, `s${i}`, code, `n${i}`);
    h.engine.handleDisconnect('s0');
    expect(joinRoom(h, 'late', code)).toBeTruthy();
  });
});

describe('not_in_room', () => {
  it('rejects room messages before join', () => {
    const h = setup();
    const msgs: ClientMessage[] = [
      { type: 'pick_track', trackId: 'flute' },
      { type: 'auto_assign' },
      { type: 'set_piece', pieceId: 'ode-to-joy' },
      { type: 'start_piece' },
      { type: 'stop_piece' },
      { type: 'remove_player', playerId: 'p1' },
      { type: 'note_played', noteIndex: 0 },
    ];
    for (const m of msgs) expect(errorCode(send(h, 'anon', m), 'anon')).toBe('not_in_room');
  });

  it('answers ping before join', () => {
    const h = setup();
    h.clock.t = 5_000;
    const pong = only(send(h, 'anon', { type: 'ping', t: 42 }), 'anon', 'pong');
    expect(pong).toEqual({ type: 'pong', t: 42, serverTime: 5_000 });
  });
});

describe('track assignment', () => {
  it('pick_track assigns a seat and rebroadcasts', () => {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    const actions = send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    const me = lastSnapshot(actions, 'cond').players.find((p) => p.id === pid);
    expect(me?.trackId).toBe('flute');
  });

  it('pick_track rejects an unknown track', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    expect(errorCode(send(h, 'p', { type: 'pick_track', trackId: 'tuba' }), 'p')).toBe(
      'track_not_found',
    );
  });

  it('pick_track rejects a full track', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'canon-in-d');
    const cello = getPiece('canon-in-d')?.tracks.find((t) => t.id === 'cello');
    if (!cello) throw new Error('fixture');
    for (let i = 0; i < cello.maxPlayers; i++) {
      joinRoom(h, `s${i}`, code);
      send(h, `s${i}`, { type: 'pick_track', trackId: 'cello' });
    }
    joinRoom(h, 'late', code);
    expect(errorCode(send(h, 'late', { type: 'pick_track', trackId: 'cello' }), 'late')).toBe(
      'track_full',
    );
  });

  it('auto_assign picks the least-occupied open track', () => {
    const h = setup();
    const code = createRoom(h); // ode: flute, violin, piano, cello, 25 each
    for (const [sock, track] of [
      ['a', 'flute'],
      ['b', 'flute'],
      ['c', 'violin'],
      ['d', 'cello'],
    ] as const) {
      joinRoom(h, sock, code);
      send(h, sock, { type: 'pick_track', trackId: track });
    }
    const pid = joinRoom(h, 'e', code);
    const actions = send(h, 'e', { type: 'auto_assign' });
    expect(lastSnapshot(actions, 'e').players.find((p) => p.id === pid)?.trackId).toBe('piano');
  });

  it('auto_assign skips full tracks', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'canon-in-d');
    for (let i = 0; i < 10; i++) {
      joinRoom(h, `s${i}`, code);
      send(h, `s${i}`, { type: 'pick_track', trackId: 'cello' });
    }
    // Cello is full (10/10); violins are empty (0/30).
    const pid = joinRoom(h, 'late', code);
    const snap = lastSnapshot(send(h, 'late', { type: 'auto_assign' }), 'late');
    expect(snap.players.find((p) => p.id === pid)?.trackId).toBe('violin-1');
  });

  it('track picks stay open while playing so a dropped phone can rejoin', () => {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    const qid = joinRoom(h, 'q', code);
    send(h, 'cond', { type: 'start_piece' });
    let snap = lastSnapshot(send(h, 'p', { type: 'pick_track', trackId: 'flute' }), 'cond');
    expect(snap.players.find((p) => p.id === pid)?.trackId).toBe('flute');
    snap = lastSnapshot(send(h, 'q', { type: 'auto_assign' }), 'cond');
    expect(snap.players.find((p) => p.id === qid)?.trackId).toBeTruthy();
  });

  it('the conductor cannot take a track in any phase', () => {
    const h = setup();
    createRoom(h);
    expect(errorCode(send(h, 'cond', { type: 'pick_track', trackId: 'flute' }), 'cond')).toBe('bad_message');
    send(h, 'cond', { type: 'start_piece' });
    expect(errorCode(send(h, 'cond', { type: 'auto_assign' }), 'cond')).toBe('bad_message');
  });
});

describe('conductor authority', () => {
  it('rejects conductor-only commands from players', () => {
    const h = setup();
    const code = createRoom(h);
    const other = joinRoom(h, 'q', code);
    joinRoom(h, 'p', code);
    const msgs: ClientMessage[] = [
      { type: 'set_piece', pieceId: 'canon-in-d' },
      { type: 'start_piece' },
      { type: 'stop_piece' },
      { type: 'remove_player', playerId: other },
    ];
    for (const m of msgs) expect(errorCode(send(h, 'p', m), 'p')).toBe('not_conductor');
  });
});

describe('phases', () => {
  it('lobby → playing → ended → playing (encore)', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);

    h.clock.t = 2_000;
    let actions = send(h, 'cond', { type: 'start_piece' });
    expect(only(actions, 'p', 'piece_started').startedAt).toBe(2_000);
    expect(lastSnapshot(actions, 'p')).toMatchObject({ phase: 'playing', startedAt: 2_000 });
    expect(errorCode(send(h, 'cond', { type: 'start_piece' }), 'cond')).toBe('already_started');

    actions = send(h, 'cond', { type: 'stop_piece' });
    expect(inbox(actions, 'p').map((m) => m.type)).toContain('piece_stopped');
    expect(lastSnapshot(actions, 'p').phase).toBe('ended');
    expect(errorCode(send(h, 'cond', { type: 'stop_piece' }), 'cond')).toBe('not_started');

    h.clock.t = 3_000;
    actions = send(h, 'cond', { type: 'start_piece' });
    expect(only(actions, 'p', 'piece_started').startedAt).toBe(3_000);
    expect(lastSnapshot(actions, 'p').phase).toBe('playing');
  });

  it('stop_piece in lobby is not_started', () => {
    const h = setup();
    createRoom(h);
    expect(errorCode(send(h, 'cond', { type: 'stop_piece' }), 'cond')).toBe('not_started');
  });

  it('set_piece swaps the piece and clears track seats', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    const actions = send(h, 'cond', { type: 'set_piece', pieceId: 'canon-in-d' });
    const snap = lastSnapshot(actions, 'p');
    expect(snap.pieceId).toBe('canon-in-d');
    expect(snap.players.every((p) => p.trackId === null)).toBe(true);
  });

  it('set_piece rejects unknown pieces and is refused while playing', () => {
    const h = setup();
    createRoom(h);
    expect(errorCode(send(h, 'cond', { type: 'set_piece', pieceId: 'nope' }), 'cond')).toBe(
      'unknown_piece',
    );
    send(h, 'cond', { type: 'start_piece' });
    expect(
      errorCode(send(h, 'cond', { type: 'set_piece', pieceId: 'canon-in-d' }), 'cond'),
    ).toBe('already_started');
  });

  it('set_piece from ended returns the room to lobby', () => {
    const h = setup();
    createRoom(h);
    send(h, 'cond', { type: 'start_piece' });
    send(h, 'cond', { type: 'stop_piece' });
    const snap = lastSnapshot(send(h, 'cond', { type: 'set_piece', pieceId: 'canon-in-d' }), 'cond');
    expect(snap).toMatchObject({ phase: 'lobby', pieceId: 'canon-in-d', startedAt: null });
  });
});

describe('note_played', () => {
  function playing(): { h: Harness; pid: string } {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    joinRoom(h, 'q', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    send(h, 'cond', { type: 'start_piece' });
    return { h, pid };
  }

  it('echoes to the conductor only', () => {
    const { h, pid } = playing();
    const actions = send(h, 'p', { type: 'note_played', noteIndex: 3 });
    const echo = { type: 'note_echo', playerId: pid, trackId: 'flute', noteIndex: 3 };
    expect(inbox(actions, 'cond')).toEqual([echo]);
    expect(inbox(actions, 'p')).toEqual([]);
    expect(inbox(actions, 'q')).toEqual([]);
  });

  it('bounds-checks the index against the track length', () => {
    const { h } = playing();
    const len = getPiece('ode-to-joy')?.tracks.find((t) => t.id === 'flute')?.events.length ?? 0;
    expect(errorCode(send(h, 'p', { type: 'note_played', noteIndex: len - 1 }), 'p')).toBeUndefined();
    expect(errorCode(send(h, 'p', { type: 'note_played', noteIndex: len }), 'p')).toBe('bad_message');
  });

  it('is rejected outside playing', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    expect(errorCode(send(h, 'p', { type: 'note_played', noteIndex: 0 }), 'p')).toBe('not_started');
  });

  it('is rejected for a player without a track', () => {
    const { h } = playing();
    expect(errorCode(send(h, 'q', { type: 'note_played', noteIndex: 0 }), 'q')).toBe(
      'track_not_found',
    );
  });
});

describe('remove_player', () => {
  it('kicks: target gets room_state without them, then is closed', () => {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    joinRoom(h, 'q', code);

    const actions = send(h, 'cond', { type: 'remove_player', playerId: pid });
    const kickedState = lastSnapshot(actions, 'p');
    expect(kickedState.players.map((p) => p.id)).not.toContain(pid);
    expect(lastSnapshot(actions, 'q').players.map((p) => p.id)).not.toContain(pid);

    const sendIdx = actions.findIndex((a) => a.kind === 'send' && a.to.includes('p'));
    const closeIdx = actions.findIndex((a) => a.kind === 'close' && a.socketId === 'p');
    expect(closeIdx).toBeGreaterThan(sendIdx);

    // The kicked socket is anonymous again.
    expect(errorCode(send(h, 'p', { type: 'auto_assign' }), 'p')).toBe('not_in_room');
    // Its later disconnect is a no-op.
    expect(h.engine.handleDisconnect('p')).toEqual([]);
  });

  it('rejects unknown players and self-removal', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    expect(errorCode(send(h, 'cond', { type: 'remove_player', playerId: 'ghost' }), 'cond')).toBe(
      'bad_message',
    );
    const condId = h.engine.snapshotOf(code)?.players.find((p) => p.conductor)?.id ?? '';
    expect(errorCode(send(h, 'cond', { type: 'remove_player', playerId: condId }), 'cond')).toBe(
      'bad_message',
    );
  });
});

describe('disconnect', () => {
  it('removes a player from the roster entirely and rebroadcasts', () => {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    joinRoom(h, 'q', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });

    const actions = h.engine.handleDisconnect('p');
    expect(lastSnapshot(actions, 'cond').players.map((p) => p.id)).not.toContain(pid);
    expect(lastSnapshot(actions, 'q').players.map((p) => p.id)).not.toContain(pid);
    expect(inbox(actions, 'p')).toEqual([]);
    expect(h.engine.snapshotOf(code)?.players.map((p) => p.id)).not.toContain(pid);
  });

  it('a dropped phone rejoining mid-piece gets its track back', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    send(h, 'cond', { type: 'start_piece' });
    h.engine.handleDisconnect('p');

    const pid = joinRoom(h, 'p2', code);
    const snap = lastSnapshot(send(h, 'p2', { type: 'pick_track', trackId: 'flute' }), 'cond');
    expect(snap.players.find((p) => p.id === pid)?.trackId).toBe('flute');
    expect(snap.players.filter((p) => !p.conductor)).toHaveLength(1);
  });

  it('conductor disconnect sends room_closed to every player, then closes them', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    joinRoom(h, 'q', code);

    const actions = h.engine.handleDisconnect('cond');
    for (const s of ['p', 'q']) {
      expect(inbox(actions, s)).toEqual([{ type: 'room_closed', reason: 'conductor_left' }]);
      const sendIdx = actions.findIndex((a) => a.kind === 'send' && a.to.includes(s));
      const closeIdx = actions.findIndex((a) => a.kind === 'close' && a.socketId === s);
      expect(closeIdx).toBeGreaterThan(sendIdx);
    }
    expect(inbox(actions, 'cond')).toEqual([]);
    const closed = actions.flatMap((a) => (a.kind === 'close' ? [a.socketId] : []));
    expect(closed.sort()).toEqual(['p', 'q']);
    expect(h.engine.roomCount).toBe(0);
    expect(errorCode(send(h, 'x', { type: 'join_room', code, name: 'x', avatar: 'y' }), 'x')).toBe(
      'room_not_found',
    );
  });

  it('ignores unknown sockets', () => {
    const h = setup();
    expect(h.engine.handleDisconnect('nobody')).toEqual([]);
  });
});

describe('ensemble_pulse', () => {
  function playing(): Harness {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    joinRoom(h, 'q', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    send(h, 'q', { type: 'pick_track', trackId: 'cello' });
    send(h, 'cond', { type: 'start_piece' });
    return h;
  }

  it('emits per-track tap counts to every socket, then resets', () => {
    const h = playing();
    send(h, 'p', { type: 'note_played', noteIndex: 0 });
    send(h, 'p', { type: 'note_played', noteIndex: 1 });
    send(h, 'q', { type: 'note_played', noteIndex: 0 });

    const actions = h.engine.tick(4_000);
    const pulse = { type: 'ensemble_pulse', counts: { flute: 2, cello: 1 }, total: 3, at: 4_000 };
    for (const s of ['cond', 'p', 'q']) expect(inbox(actions, s)).toEqual([pulse]);

    expect(h.engine.tick(4_250)).toEqual([]);
    send(h, 'q', { type: 'note_played', noteIndex: 1 });
    expect(only(h.engine.tick(4_500), 'p', 'ensemble_pulse')).toEqual({
      type: 'ensemble_pulse',
      counts: { cello: 1 },
      total: 1,
      at: 4_500,
    });
  });

  it('does not count rejected taps', () => {
    const h = playing();
    send(h, 'p', { type: 'note_played', noteIndex: 9_999 });
    expect(h.engine.tick(4_000)).toEqual([]);
  });

  it('stays silent outside playing', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    expect(h.engine.tick(2_000)).toEqual([]);
    send(h, 'cond', { type: 'start_piece' });
    expect(h.engine.tick(2_250)).toEqual([]);
  });

  it('flushes pending taps when the piece stops', () => {
    const h = playing();
    send(h, 'p', { type: 'note_played', noteIndex: 0 });
    h.clock.t = 5_000;
    const actions = send(h, 'cond', { type: 'stop_piece' });
    const types = inbox(actions, 'q').map((m) => m.type);
    expect(types.indexOf('ensemble_pulse')).toBeLessThan(types.indexOf('piece_stopped'));
    expect(only(actions, 'q', 'ensemble_pulse')).toMatchObject({ counts: { flute: 1 }, total: 1, at: 5_000 });
    expect(h.engine.tick(5_250)).toEqual([]);
  });

  it('pulses each room independently', () => {
    const h = playing();
    const other = createRoom(h, 'c2');
    joinRoom(h, 'r', other);
    send(h, 'r', { type: 'pick_track', trackId: 'violin' });
    send(h, 'c2', { type: 'start_piece' });
    send(h, 'r', { type: 'note_played', noteIndex: 0 });
    const actions = h.engine.tick(4_000);
    expect(inbox(actions, 'p')).toEqual([]);
    expect(only(actions, 'r', 'ensemble_pulse').counts).toEqual({ violin: 1 });
  });
});

describe('handleFrame', () => {
  it('drops malformed frames with bad_message and never throws', () => {
    const h = setup();
    for (const raw of ['', 'not json', '[]', 'null', '{"type":"nope"}', '{"type":"pick_track"}']) {
      expect(errorCode(h.engine.handleFrame('s', raw), 's')).toBe('bad_message');
    }
  });

  it('routes valid frames through the engine', () => {
    const h = setup();
    const actions = h.engine.handleFrame('s', encodeMessage({ type: 'create_room', pieceId: 'ode-to-joy' }));
    expect(only(actions, 's', 'room_created').code).toHaveLength(CODE_LEN);
  });
});

describe('scheduled start and tempo', () => {
  it('start_piece with countIn schedules startedAt in the future and carries the piece bpm', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    joinRoom(h, 'p', code);
    h.clock.t = 5_000;
    const actions = send(h, 'cond', { type: 'start_piece', countIn: true });
    const started = only(actions, 'p', 'piece_started');
    expect(started.startedAt).toBe(5_000 + COUNT_IN_MS);
    expect(started.bpm).toBe(getPiece('ode-to-joy')!.bpm);
    expect(lastSnapshot(actions, 'p').startedAt).toBe(5_000 + COUNT_IN_MS);
  });

  it('start_piece without countIn starts now', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    h.clock.t = 7_000;
    expect(only(send(h, 'cond', { type: 'start_piece' }), 'p', 'piece_started').startedAt).toBe(7_000);
  });

  it('set_tempo broadcasts an anchor and stores it in the snapshot', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy'); // 100 bpm
    joinRoom(h, 'p', code);
    h.clock.t = 10_000;
    send(h, 'cond', { type: 'start_piece' });
    h.clock.t = 16_000; // 6 s at 100 bpm = beat 10
    const actions = send(h, 'cond', { type: 'set_tempo', bpm: 120 });
    const tempo = only(actions, 'p', 'tempo');
    expect(tempo).toEqual({ type: 'tempo', bpm: 120, at: 16_000, beat: 10 });
    expect(lastSnapshot(actions, 'p').tempo).toEqual({ bpm: 120, at: 16_000, beat: 10 });
  });

  it('a second set_tempo continues the beat count from the previous anchor', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    joinRoom(h, 'p', code);
    h.clock.t = 0;
    send(h, 'cond', { type: 'start_piece' });
    h.clock.t = 6_000; // beat 10 at 100 bpm
    send(h, 'cond', { type: 'set_tempo', bpm: 120 });
    h.clock.t = 11_000; // +5 s at 120 bpm = +10 beats
    expect(only(send(h, 'cond', { type: 'set_tempo', bpm: 60 }), 'p', 'tempo')).toMatchObject({ bpm: 60, at: 11_000, beat: 20 });
  });

  it('set_tempo is conductor only', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    expect(errorCode(send(h, 'p', { type: 'set_tempo', bpm: 90 }), 'p')).toBe('not_conductor');
  });

  it('a fresh start clears the tempo anchor', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'cond', { type: 'start_piece' });
    send(h, 'cond', { type: 'set_tempo', bpm: 90 });
    send(h, 'cond', { type: 'stop_piece' });
    expect(lastSnapshot(send(h, 'cond', { type: 'start_piece' }), 'p').tempo).toBeNull();
  });
});

describe('assign_track', () => {
  it('conductor can seat a player, including mid-piece', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    const pid = joinRoom(h, 'p', code);
    send(h, 'cond', { type: 'start_piece' });
    const actions = send(h, 'cond', { type: 'assign_track', playerId: pid, trackId: 'cello' });
    expect(lastSnapshot(actions, 'p').players.find((x) => x.id === pid)?.trackId).toBe('cello');
  });

  it('conductor can unseat a player with null', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    const pid = joinRoom(h, 'p', code);
    send(h, 'p', { type: 'pick_track', trackId: 'flute' });
    const actions = send(h, 'cond', { type: 'assign_track', playerId: pid, trackId: null });
    expect(lastSnapshot(actions, 'p').players.find((x) => x.id === pid)?.trackId).toBeNull();
  });

  it('respects track capacity and rejects unknown players/tracks', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'canon-in-d'); // cello max 10
    const ids = Array.from({ length: 11 }, (_, i) => joinRoom(h, `p${i}`, code));
    for (let i = 0; i < 10; i++) send(h, 'cond', { type: 'assign_track', playerId: ids[i]!, trackId: 'cello' });
    expect(errorCode(send(h, 'cond', { type: 'assign_track', playerId: ids[10]!, trackId: 'cello' }), 'cond')).toBe('track_full');
    expect(errorCode(send(h, 'cond', { type: 'assign_track', playerId: 'nope', trackId: 'cello' }), 'cond')).toBe('bad_message');
    expect(errorCode(send(h, 'cond', { type: 'assign_track', playerId: ids[0]!, trackId: 'tuba' }), 'cond')).toBe('track_not_found');
  });

  it('players cannot assign', () => {
    const h = setup();
    const code = createRoom(h);
    const pid = joinRoom(h, 'p', code);
    expect(errorCode(send(h, 'p', { type: 'assign_track', playerId: pid, trackId: 'flute' }), 'p')).toBe('not_conductor');
  });
});

describe('dj cues', () => {
  it('broadcasts the cue with a server timestamp while playing', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    send(h, 'cond', { type: 'start_piece' });
    h.clock.t = 20_000;
    const actions = send(h, 'cond', { type: 'dj', cue: 'drop', bars: 2 });
    expect(only(actions, 'p', 'dj')).toEqual({ type: 'dj', cue: 'drop', at: 20_000, bars: 2 });
    expect(only(actions, 'cond', 'dj').cue).toBe('drop');
  });

  it('is refused outside playing and from players', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'p', code);
    expect(errorCode(send(h, 'cond', { type: 'dj', cue: 'build' }), 'cond')).toBe('not_started');
    send(h, 'cond', { type: 'start_piece' });
    expect(errorCode(send(h, 'p', { type: 'dj', cue: 'build' }), 'p')).toBe('not_conductor');
  });
});

describe('piece_results', () => {
  const tally = (perfect: number, miss = 0) => ({ perfect, great: 0, good: 0, miss, streakBest: perfect });

  it('aggregates tallies by section and emits once after the grace window', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    joinRoom(h, 'a', code); joinRoom(h, 'b', code); joinRoom(h, 'c', code);
    send(h, 'a', { type: 'pick_track', trackId: 'flute' });
    send(h, 'b', { type: 'pick_track', trackId: 'flute' });
    send(h, 'c', { type: 'pick_track', trackId: 'cello' });
    send(h, 'cond', { type: 'start_piece' });
    h.clock.t = 50_000;
    send(h, 'cond', { type: 'stop_piece' });
    send(h, 'a', { type: 'player_tally', tally: tally(8, 2) });
    send(h, 'b', { type: 'player_tally', tally: tally(10, 0) });
    send(h, 'c', { type: 'player_tally', tally: tally(5, 5) });

    expect(inbox(h.engine.tick(50_000 + RESULTS_GRACE_MS - 1), 'cond').map((m) => m.type)).not.toContain('piece_results');
    const actions = h.engine.tick(50_000 + RESULTS_GRACE_MS);
    const res = only(actions, 'a', 'piece_results').results;
    const flute = res.sections.find((s) => s.trackId === 'flute')!;
    expect(flute).toMatchObject({ players: 2, perfect: 18, miss: 2, streakBest: 10 });
    expect(flute.accuracy).toBeCloseTo(0.9);
    expect(res.room).toMatchObject({ notes: 30 });
    expect(res.room.accuracy).toBeCloseTo(23 / 30);
    expect(res.room.grade).toBe('B');
    expect(inbox(h.engine.tick(60_000), 'a').map((m) => m.type)).not.toContain('piece_results');
  });

  it('ignores tallies from players without a track and outside the window', () => {
    const h = setup();
    const code = createRoom(h, 'cond', 'ode-to-joy');
    joinRoom(h, 'a', code);
    send(h, 'a', { type: 'pick_track', trackId: 'flute' });
    send(h, 'cond', { type: 'start_piece' });
    expect(errorCode(send(h, 'a', { type: 'player_tally', tally: tally(3) }), 'a')).toBe('not_started');
    h.clock.t = 1_000; send(h, 'cond', { type: 'stop_piece' });
    h.clock.t = 1_000 + RESULTS_GRACE_MS + 1;
    expect(errorCode(send(h, 'a', { type: 'player_tally', tally: tally(3) }), 'a')).toBe('bad_message');
  });

  it('emits empty results when nobody reports', () => {
    const h = setup();
    const code = createRoom(h);
    joinRoom(h, 'a', code);
    send(h, 'cond', { type: 'start_piece' });
    h.clock.t = 2_000; send(h, 'cond', { type: 'stop_piece' });
    const res = only(h.engine.tick(2_000 + RESULTS_GRACE_MS), 'cond', 'piece_results').results;
    expect(res.room).toEqual({ notes: 0, accuracy: 0, grade: 'D' });
  });
});
