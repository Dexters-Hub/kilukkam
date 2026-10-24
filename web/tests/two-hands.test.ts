import { note, rest, type ScoreEvent } from '@kilukkam/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHORD_MS, createHands, keyHand, sideOf } from '../src/features/play/hands.js';
import { assignLanes } from '../src/features/play/lanes.js';
import type { LaneSide } from '../src/lib/lane.js';
import { breakCombo, emptyTally, record } from '../src/lib/rhythm.js';

describe('lane assignment', () => {
  it('splits a melody around its median: low notes left, high notes right, rests have no lane', () => {
    // Median of C4 E4 G4 C5 G5 C6 is 69.5: C4 is clearly low, C6 clearly high.
    const events = [note(60, 1), rest(1), note(64, 1), note(67, 1), note(72, 1), note(79, 1), note(84, 1)];
    expect(assignLanes(events, 'violin')).toEqual(['left', null, 'left', 'left', 'right', 'right', 'right']);
  });

  it('keeps a repeated note in its lane near the median', () => {
    const events = [note(48, 1), note(60, 1), note(60, 1), note(60, 1), note(72, 1)];
    const lanes = assignLanes(events, 'cello');
    expect(lanes[2]).toBe(lanes[1]);
    expect(lanes[3]).toBe(lanes[1]);
  });

  it('alternates hands through a run near the median', () => {
    const run = [note(40, 1), note(64, 0.5), note(65, 0.5), note(67, 0.5), note(65, 0.5), note(90, 1)];
    const lanes = assignLanes(run, 'flute');
    expect(lanes.slice(1, 5)).toEqual(['right', 'left', 'right', 'left']);
    expect(lanes[0]).toBe('left');
    expect(lanes[5]).toBe('right');
  });

  it('puts kick and toms on the left, snare, clap, hats and cymbals on the right', () => {
    const kit = [36, 38, 42, 35, 39, 46, 41, 49, 45, 51].map((k) => note(k, 0.5));
    expect(assignLanes(kit, 'drums')).toEqual(['left', 'right', 'right', 'left', 'right', 'right', 'left', 'right', 'left', 'right']);
  });

  it('marks notes that start together as a chord across both lanes', () => {
    // The shared score format is one line per part, so a chord only appears when two
    // notes share an onset; build that case directly.
    const zero = { kind: 'note', midi: 60, beats: 0 } as unknown as ScoreEvent;
    const events = [note(55, 1), zero, note(64, 1), note(72, 1)];
    expect(assignLanes(events, 'piano').slice(1, 3)).toEqual(['both', 'both']);
    expect(assignLanes(events, 'drums').slice(1, 3)).toEqual(['both', 'both']);
  });

  it('copes with an empty part', () => {
    expect(assignLanes([], 'violin')).toEqual([]);
    expect(assignLanes([rest(4)], 'violin')).toEqual([null]);
  });
});

describe('hands input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (lane: LaneSide | null) => {
    let t = 1000;
    const hits: [LaneSide, number][] = [];
    const hands = createHands(
      () => lane,
      (hit, late) => hits.push([hit, late]),
      () => t,
    );
    return { hands, hits, at: (ms: number) => (t = ms) };
  };

  it('fires a single-lane hit at once', () => {
    const { hands, hits } = setup('left');
    hands.press('right', 1000);
    expect(hits).toEqual([['right', 0]]);
  });

  it('pairs two hands inside the chord window, judged from the first finger', () => {
    const { hands, hits, at } = setup('both');
    hands.press('left', 1000);
    expect(hits).toEqual([]);
    at(1040);
    hands.press('right', 1040);
    expect(hits).toEqual([['both', 40]]);
    vi.advanceTimersByTime(CHORD_MS * 2);
    expect(hits).toHaveLength(1);
  });

  it('lets a lone finger on a chord fall through as one side once the window closes', () => {
    const { hands, hits, at } = setup('both');
    hands.press('right', 1000);
    at(1000 + CHORD_MS);
    vi.advanceTimersByTime(CHORD_MS);
    expect(hits).toEqual([['right', CHORD_MS]]);
  });

  it('does not pair a second hand that comes too late or the same hand twice', () => {
    const late = setup('both');
    late.hands.press('left', 1000);
    late.at(1000 + CHORD_MS + 1);
    late.hands.press('right', 1000 + CHORD_MS + 1);
    expect(late.hits[0]?.[0]).toBe('left');

    const same = setup('both');
    same.hands.press('left', 1000);
    same.hands.press('left', 1010);
    expect(same.hits[0]?.[0]).toBe('left');
  });

  it('cancel drops a half-made chord', () => {
    const { hands, hits } = setup('both');
    hands.press('left', 1000);
    hands.cancel();
    vi.advanceTimersByTime(CHORD_MS * 2);
    expect(hits).toEqual([]);
  });

  it('maps keys and surface halves to hands', () => {
    expect(keyHand('KeyF')).toBe('left');
    expect(keyHand('KeyD')).toBe('left');
    expect(keyHand('KeyJ')).toBe('right');
    expect(keyHand('KeyK')).toBe('right');
    expect(keyHand('Space')).toBeNull();
    expect(sideOf(10, 0, 390)).toBe('left');
    expect(sideOf(194, 0, 390)).toBe('left');
    expect(sideOf(195, 0, 390)).toBe('right');
  });
});

describe('wrong side', () => {
  it('breaks the combo without counting a note', () => {
    const t = record(record(emptyTally(), 'perfect'), 'great');
    const broken = breakCombo(t);
    expect(broken.combo).toBe(0);
    expect(broken.notes).toBe(2);
    expect(broken.bestCombo).toBe(2);
    expect(broken.accuracy).toBe(t.accuracy);
    expect(breakCombo(emptyTally())).toEqual(emptyTally());
  });
});
