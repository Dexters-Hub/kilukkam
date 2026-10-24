import type { RoomSnapshot } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { pulseBumps, rejoinPlan, type Session } from '../src/store.js';

describe('pulseBumps', () => {
  const first = () => 0; // always pick the first remaining id

  it('bumps one dot per tap, per track', () => {
    const ids = new Map([
      ['flute', ['a', 'b', 'c']],
      ['cello', ['d']],
    ]);
    expect(pulseBumps({ flute: 2, cello: 1 }, ids, 8, first)).toEqual(['a', 'b', 'd']);
  });

  it('never bumps more dots than are shown or than the cap', () => {
    const ids = new Map([['flute', ['a', 'b']]]);
    expect(pulseBumps({ flute: 9 }, ids, 8, first)).toEqual(['a', 'b']);
    const many = new Map([['violin', ['a', 'b', 'c', 'd', 'e']]]);
    expect(pulseBumps({ violin: 50 }, many, 3, first)).toHaveLength(3);
  });

  it('picks distinct dots and ignores tracks with no dots', () => {
    const ids = new Map([['flute', ['a', 'b', 'c', 'd']]]);
    const out = pulseBumps({ flute: 4, tuba: 3 }, ids, 8, Math.random);
    expect(new Set(out).size).toBe(4);
  });
});

describe('rejoinPlan', () => {
  const session: Session = { role: 'player', code: 'ABCD', name: 'Asha', avatar: 'bach', trackId: 'flute' };
  const snap = (phase: RoomSnapshot['phase'], startedAt: number | null): RoomSnapshot => ({
    code: 'ABCD',
    phase,
    pieceId: 'ode-to-joy',
    players: [],
    maxPlayers: 100,
    startedAt,
  });

  it('re-picks the stored track in the lobby', () => {
    expect(rejoinPlan(snap('lobby', null), session, null, 0)).toEqual({ pick: 'flute', resumeCursor: null });
  });

  it('re-picks mid-piece and resumes the cursor when the run is the same', () => {
    expect(rejoinPlan(snap('playing', 2_000), session, 2_000, 7)).toEqual({ pick: 'flute', resumeCursor: 7 });
  });

  it('starts from the top when a new run began while we were away', () => {
    expect(rejoinPlan(snap('playing', 3_000), session, 2_000, 7)).toEqual({ pick: 'flute', resumeCursor: null });
  });

  it('has nothing to re-pick without a stored track', () => {
    expect(rejoinPlan(snap('playing', 2_000), { ...session, trackId: null }, 2_000, 7)).toEqual({
      pick: null,
      resumeCursor: null,
    });
  });
});
