import { describe, it, expect } from 'vitest';
import {
  parseClientMessage, parseServerMessage, encodeMessage,
  MAX_NAME_LEN, MAX_PLAYERS, CODE_LEN,
} from '../src/protocol.js';

describe('parseClientMessage', () => {
  it('parses create_room', () => {
    expect(parseClientMessage('{"type":"create_room","pieceId":"canon-in-d"}'))
      .toEqual({ type: 'create_room', pieceId: 'canon-in-d' });
  });

  it('parses join_room', () => {
    expect(parseClientMessage('{"type":"join_room","code":"AB3F","name":"Alu","avatar":"🦊"}'))
      .toEqual({ type: 'join_room', code: 'AB3F', name: 'Alu', avatar: '🦊' });
  });

  it('parses note_played', () => {
    expect(parseClientMessage('{"type":"note_played","noteIndex":12}'))
      .toEqual({ type: 'note_played', noteIndex: 12 });
  });

  it('rejects unknown type', () => {
    expect(parseClientMessage('{"type":"hack"}')).toBeNull();
  });

  it('rejects invalid JSON', () => {
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('rejects non-object', () => {
    expect(parseClientMessage('"str"')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parseClientMessage('{"type":"join_room","code":"AB3F"}')).toBeNull();
  });

  it('rejects over-long names', () => {
    const name = 'x'.repeat(MAX_NAME_LEN + 1);
    expect(parseClientMessage(JSON.stringify({ type: 'join_room', code: 'AB3F', name, avatar: 'a' }))).toBeNull();
  });

  it('parses conductor commands', () => {
    expect(parseClientMessage('{"type":"start_piece"}')).toEqual({ type: 'start_piece' });
    expect(parseClientMessage('{"type":"remove_player","playerId":"p1"}'))
      .toEqual({ type: 'remove_player', playerId: 'p1' });
  });
});

describe('parseServerMessage', () => {
  it('parses room_state', () => {
    const msg = {
      type: 'room_state',
      snapshot: {
        code: 'AB3F', phase: 'lobby', pieceId: 'canon-in-d',
        players: [{ id: 'p1', name: 'A', avatar: '🦊', trackId: 'violin-1', connected: true, conductor: false }],
        maxPlayers: MAX_PLAYERS, startedAt: null, dynamics: 'mf', mutedTracks: [],
      },
    };
    expect(parseServerMessage(JSON.stringify(msg))).toEqual(msg);
  });

  it('parses error', () => {
    expect(parseServerMessage('{"type":"error","code":"room_full","message":"full"}'))
      .toEqual({ type: 'error', code: 'room_full', message: 'full' });
  });

  it('rejects bad snapshot', () => {
    expect(parseServerMessage('{"type":"room_state","snapshot":{"code":123}}')).toBeNull();
  });
});

describe('encodeMessage', () => {
  it('round-trips', () => {
    const m = { type: 'ping' as const, t: 123 };
    expect(parseClientMessage(encodeMessage(m))).toEqual(m);
  });
});

describe('constants', () => {
  it('room code is short', () => {
    expect(CODE_LEN).toBeGreaterThanOrEqual(4);
    expect(CODE_LEN).toBeLessThanOrEqual(6);
  });

  it('supports 100 participants', () => {
    expect(MAX_PLAYERS).toBe(100);
  });
});
