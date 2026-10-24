import { note, rest, type ScoreEvent } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { advanceCursor, nextEvents, progress, skipRests } from '../src/lib/store.js';

// rest, C4, rest, rest, D4, E4, rest
const EVENTS: ScoreEvent[] = [rest(8), note(60, 1), rest(1), rest(2), note(62, 2), note(64, 1), rest(1)];

describe('skipRests', () => {
  it('moves to the next note', () => {
    expect(skipRests(EVENTS, 0)).toBe(1);
    expect(skipRests(EVENTS, 2)).toBe(4);
    expect(skipRests(EVENTS, 4)).toBe(4);
  });
  it('returns length when only rests remain', () => {
    expect(skipRests(EVENTS, 6)).toBe(EVENTS.length);
    expect(skipRests([], 0)).toBe(0);
  });
});

describe('advanceCursor', () => {
  it('steps past the played note and following rests', () => {
    expect(advanceCursor(EVENTS, 0)).toBe(4); // plays C4 (index 1), lands on D4
    expect(advanceCursor(EVENTS, 4)).toBe(5);
    expect(advanceCursor(EVENTS, 5)).toBe(EVENTS.length); // trailing rest skipped
  });
  it('stays at the end once finished', () => {
    expect(advanceCursor(EVENTS, EVENTS.length)).toBe(EVENTS.length);
  });
});

describe('nextEvents', () => {
  it('returns current + next two notes with rest cues', () => {
    const w = nextEvents(EVENTS, 0);
    expect(w.map((x) => x.index)).toEqual([1, 4, 5]);
    expect(w.map((x) => x.restBefore)).toEqual([8, 3, 0]);
    expect(w[0]?.note.midi).toBe(60);
  });
  it('shrinks near the end', () => {
    expect(nextEvents(EVENTS, 5).map((x) => x.index)).toEqual([5]);
    expect(nextEvents(EVENTS, EVENTS.length)).toEqual([]);
  });
  it('honours a custom window size', () => {
    expect(nextEvents(EVENTS, 0, 1)).toHaveLength(1);
  });
});

describe('progress', () => {
  it('is cursor over length, clamped', () => {
    expect(progress(EVENTS, 0)).toBe(0);
    expect(progress(EVENTS, EVENTS.length)).toBe(1);
    expect(progress([], 3)).toBe(0);
  });
});
