import { describe, expect, it } from 'vitest';
import { RESUME_COUNT_IN_BEATS, type ClientMessage, type ErrorCode, type RoomSnapshot, type ServerMessage } from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from '../src/room-engine.js';

// Pause and resume (the camera conductor's fist and open palm), and the tempo
// anchors the camera sends while a piece plays.

const setup = () => {
  const clock = { t: 0 };
  let n = 0;
  const engine = new RoomEngine({ now: () => clock.t, newId: () => `p${++n}` });
  const send = (socketId: string, msg: ClientMessage) => engine.handleMessage(socketId, msg);
  const created = send('cond', { type: 'create_room', pieceId: 'ode-to-joy' }); // 100 bpm
  const code = (created[0] as Extract<EngineAction, { kind: 'send' }>).msg as Extract<ServerMessage, { type: 'room_created' }>;
  send('p', { type: 'join_room', code: code.code, name: 'Anu', avatar: 'bach' });
  send('p', { type: 'pick_track', trackId: 'cello' });
  return { clock, send, engine, code: code.code };
};

const inbox = (actions: EngineAction[], socketId: string): ServerMessage[] =>
  actions.flatMap((a) => (a.kind === 'send' && a.to.includes(socketId) ? [a.msg] : []));
const find = <T extends ServerMessage['type']>(actions: EngineAction[], type: T) =>
  inbox(actions, 'p').find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
const snap = (actions: EngineAction[]): RoomSnapshot | undefined =>
  inbox(actions, 'p').filter((m) => m.type === 'room_state').map((m) => (m as Extract<ServerMessage, { type: 'room_state' }>).snapshot).pop();
const errorOf = (actions: EngineAction[], socketId: string): ErrorCode | undefined =>
  (inbox(actions, socketId).find((m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }> | undefined)?.code;

describe('pause_piece and resume_piece', () => {
  it('freezes the grid on the beat it paused and resumes from that beat after a count-in', () => {
    const h = setup();
    h.send('cond', { type: 'start_piece' });
    h.clock.t = 6_000; // beat 10 at 100 bpm
    const paused = h.send('cond', { type: 'pause_piece' });
    expect(find(paused, 'piece_paused')).toEqual({ type: 'piece_paused', at: 6_000, beat: 10 });
    expect(snap(paused)?.paused).toEqual({ at: 6_000, beat: 10, bpm: 100 });
    expect(snap(paused)?.phase).toBe('playing');

    h.clock.t = 20_000; // 14 s later: the room has not moved on
    const resumed = h.send('cond', { type: 'resume_piece' });
    const countIn = (RESUME_COUNT_IN_BEATS * 60_000) / 100;
    expect(find(resumed, 'piece_resumed')).toEqual({ type: 'piece_resumed', bpm: 100, at: 20_000 + countIn, beat: 10 });
    expect(snap(resumed)?.paused).toBeNull();
    expect(snap(resumed)?.tempo).toEqual({ bpm: 100, at: 20_000 + countIn, beat: 10 });

    // A tempo change after the resume continues from the resumed grid.
    h.clock.t = 20_000 + countIn + 3_000; // +5 beats at 100 bpm
    expect(find(h.send('cond', { type: 'set_tempo', bpm: 120 }), 'tempo')).toMatchObject({ beat: 15 });
  });

  it('keeps a tempo change made while paused for the resume, without moving the grid', () => {
    const h = setup();
    h.send('cond', { type: 'start_piece' });
    h.clock.t = 3_000; // beat 5
    h.send('cond', { type: 'pause_piece' });
    h.clock.t = 4_000;
    const slower = h.send('cond', { type: 'set_tempo', bpm: 80 });
    expect(find(slower, 'tempo')).toBeUndefined();
    expect(snap(slower)?.paused).toEqual({ at: 3_000, beat: 5, bpm: 80 });
    h.clock.t = 9_000;
    expect(find(h.send('cond', { type: 'resume_piece' }), 'piece_resumed')).toMatchObject({ beat: 5, bpm: 80, at: 9_000 + 1_500 });
  });

  it('refuses taps and DJ cues while paused, and errors for a pause out of place', () => {
    const h = setup();
    expect(errorOf(h.send('cond', { type: 'pause_piece' }), 'cond')).toBe('not_started');
    h.send('cond', { type: 'start_piece' });
    expect(errorOf(h.send('cond', { type: 'resume_piece' }), 'cond')).toBe('not_started');
    expect(errorOf(h.send('p', { type: 'pause_piece' }), 'p')).toBe('not_conductor');
    h.send('cond', { type: 'pause_piece' });
    expect(errorOf(h.send('cond', { type: 'pause_piece' }), 'cond')).toBe('bad_message');
    expect(errorOf(h.send('p', { type: 'note_played', noteIndex: 0 }), 'p')).toBe('not_started');
    expect(errorOf(h.send('cond', { type: 'dj', cue: 'drop' }), 'cond')).toBe('not_started');
  });

  it('only Stop ends a paused piece, and a fresh start is not paused', () => {
    const h = setup();
    h.send('cond', { type: 'start_piece' });
    h.send('cond', { type: 'pause_piece' });
    h.clock.t = 120_000;
    expect(h.engine.tick(h.clock.t).length).toBe(0);
    expect(h.engine.snapshotOf(h.code)?.phase).toBe('playing');
    const stopped = h.send('cond', { type: 'stop_piece' });
    expect(snap(stopped)?.phase).toBe('ended');
    expect(snap(stopped)?.paused).toBeNull();
    expect(snap(h.send('cond', { type: 'start_piece' }))?.paused).toBeNull();
  });
});

describe('camera tempo changes', () => {
  it('never end the piece, however many arrive', () => {
    const h = setup();
    h.send('cond', { type: 'start_piece' });
    for (let i = 0; i < 40; i++) {
      h.clock.t += 250;
      const actions = h.send('cond', { type: 'set_tempo', bpm: i % 2 ? 60 : 180 });
      expect(find(actions, 'piece_stopped')).toBeUndefined();
      expect(snap(actions)?.phase).toBe('playing');
    }
  });

  it('keep the count-in when the tempo changes before the first downbeat', () => {
    const h = setup();
    h.clock.t = 1_000;
    h.send('cond', { type: 'start_piece', countIn: true }); // downbeat at 4 000
    h.clock.t = 2_200; // 1.8 s before the downbeat at 100 bpm = beat -3
    const t = find(h.send('cond', { type: 'set_tempo', bpm: 120 }), 'tempo');
    expect(t?.beat).toBeCloseTo(-3, 6);
  });
});

describe('kilukkam', () => {
  it('rings every phone, at most once in 3 s, and only from the conductor while playing', () => {
    const h = setup();
    expect(errorOf(h.send('cond', { type: 'kilukkam' }), 'cond')).toBe('not_started');
    h.send('cond', { type: 'start_piece' });
    h.clock.t = 1_000;
    expect(find(h.send('cond', { type: 'kilukkam' }), 'kilukkam')).toEqual({ type: 'kilukkam', at: 1_000 });
    h.clock.t = 3_999;
    expect(h.send('cond', { type: 'kilukkam' })).toEqual([]);
    h.clock.t = 4_000;
    expect(find(h.send('cond', { type: 'kilukkam' }), 'kilukkam')?.at).toBe(4_000);
    expect(errorOf(h.send('p', { type: 'kilukkam' }), 'p')).toBe('not_conductor');
  });
});
