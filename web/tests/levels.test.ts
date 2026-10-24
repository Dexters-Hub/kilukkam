import { PIECES, note, rest, type ScoreEvent } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { FLICK_MS, FLICK_PX, isFlick, keyLane, laneAt } from '../src/features/play/hands.js';
import { ACCENT_MARGIN, assignLanes, bandOf, drumLane, flickNotes, holdNotes, quartiles } from '../src/features/play/lanes.js';
import { DEFAULT_LEVEL, LEVEL_PREF, laneCount, loadLevel, lookahead, noteTypes, saveLevel } from '../src/features/play/levels.js';
import { laneTints, shade } from '../src/lib/lane.js';
import { HOLD_RELEASE_MS, emptyTally, flickJudgement, record, regrade, releaseJudgement } from '../src/lib/rhythm.js';

const notesOf = (events: readonly ScoreEvent[], lanes: readonly (number | null)[]) =>
  events.flatMap((e, i) => (e.kind === 'note' ? [{ midi: e.midi, lane: lanes[i] as number }] : []));

describe('one and two lanes', () => {
  it('puts every note of an Easy part in the one lane', () => {
    expect(assignLanes([note(60, 1), rest(1), note(72, 1)], 'violin', 1)).toEqual([0, null, 0]);
  });

  it('splits a melody around its median: low notes left, high notes right, rests have no lane', () => {
    const events = [note(60, 1), rest(1), note(64, 1), note(67, 1), note(72, 1), note(79, 1), note(84, 1)];
    expect(assignLanes(events, 'violin', 2)).toEqual([0, null, 0, 0, 1, 1, 1]);
  });

  it('alternates hands through a run near the median and keeps a repeated note', () => {
    const run = [note(40, 1), note(64, 0.5), note(65, 0.5), note(65, 0.5), note(67, 0.5), note(90, 1)];
    expect(assignLanes(run, 'flute', 2)).toEqual([0, 1, 0, 0, 1, 1]);
  });

  it('puts kick and toms on the left, snare, clap, hats and cymbals on the right', () => {
    const kit = [36, 38, 42, 35, 39, 46, 41, 49, 45, 51].map((k) => note(k, 0.5));
    expect(assignLanes(kit, 'drums', 2)).toEqual([0, 1, 1, 0, 1, 1, 0, 1, 0, 1]);
  });
});

describe('four lanes', () => {
  it('starts each phrase in its quarter of the part’s own range', () => {
    // Range C4 to C5 in eight notes: quarters split at E4, G4 and B4.
    const pitches = [60, 72, 65, 69, 62, 71, 64, 67];
    const events = pitches.flatMap((m) => [note(m, 1), rest(1)]);
    expect(quartiles(events)).toEqual([64, 67, 71]);
    expect(pitches.map((m) => bandOf(m, [64, 67, 71]))).toEqual([0, 3, 1, 2, 0, 3, 1, 2]);
    expect(notesOf(events, assignLanes(events, 'violin', 4)).map((n) => n.lane)).toEqual([0, 3, 1, 2, 0, 3, 1, 2]);
  });

  it('moves a step to the neighbouring lane and bounces off the edge', () => {
    const scale = [60, 62, 64, 65, 67, 69].map((m) => note(m, 0.5));
    expect(assignLanes(scale, 'flute', 4)).toEqual([0, 1, 2, 3, 2, 3]);
    const down = [72, 71, 69, 67, 65].map((m) => note(m, 0.5));
    expect(assignLanes(down, 'flute', 4)).toEqual([3, 2, 1, 0, 1]);
  });

  it('jumps a leap at least two lanes when there is room', () => {
    const events = [60, 62, 64, 65, 67, 69, 71, 72].map((m) => note(m, 0.5));
    // C4 (lane 0) up a fifth to G4: two lanes or more.
    const leap = assignLanes([events[0] as ScoreEvent, note(67, 0.5), ...events.slice(1)], 'violin', 4);
    expect((leap[1] as number) - (leap[0] as number)).toBeGreaterThanOrEqual(2);
    // An octave drop from the top lane lands two lanes down at least.
    const drop = assignLanes([note(72, 0.5), note(60, 0.5), ...events], 'violin', 4);
    expect(drop[0]).toBe(3);
    expect(drop[1]).toBeLessThanOrEqual(1);
  });

  it('keeps a repeated note in its lane', () => {
    const events = [note(60, 1), note(64, 1), note(64, 1), note(64, 1), note(72, 1)];
    const lanes = assignLanes(events, 'cello', 4);
    expect(lanes[2]).toBe(lanes[1]);
    expect(lanes[3]).toBe(lanes[1]);
  });

  it('never repeats a lane when the pitch changes, across every melodic part of every piece', () => {
    for (const piece of PIECES) {
      for (const track of piece.tracks) {
        if (track.instrument === 'drums') continue;
        const ns = notesOf(track.events, assignLanes(track.events, track.instrument, 4));
        ns.forEach((n, i) => {
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThanOrEqual(3);
          const prev = ns[i - 1];
          if (prev && prev.midi !== n.midi) expect(n.lane, `${piece.id}/${track.id} note ${i}`).not.toBe(prev.lane);
          if (prev && prev.midi === n.midi) expect(n.lane).toBe(prev.lane);
        });
        // Spread: a part with real range uses every lane; even a narrow one uses at least three.
        const pitches = new Set(ns.map((n) => n.midi)).size;
        const used = new Set(ns.map((n) => n.lane)).size;
        if (pitches >= 8) expect(used, `${piece.id}/${track.id}`).toBe(4);
        else if (pitches >= 4) expect(used, `${piece.id}/${track.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('maps the kit: kick, snare and clap, hats, cymbals and toms', () => {
    expect([35, 36].map(drumLane)).toEqual([0, 0]);
    expect([38, 39, 40].map(drumLane)).toEqual([1, 1, 1]);
    expect([42, 44, 46].map(drumLane)).toEqual([2, 2, 2]);
    expect([49, 57, 41, 43, 45, 47, 48, 50].map(drumLane)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(assignLanes([note(36, 1), rest(1), note(38, 1), note(42, 1), note(49, 1)], 'drums', 4)).toEqual([0, null, 1, 2, 3]);
  });

  it('copes with an empty part', () => {
    expect(assignLanes([], 'violin', 4)).toEqual([]);
    expect(assignLanes([rest(4)], 'violin', 4)).toEqual([null]);
  });
});

describe('lane input', () => {
  it('splits the surface into quarters (or halves) and clamps the edges', () => {
    expect([0, 97, 98, 194, 195, 292, 293, 389].map((x) => laneAt(x, 0, 390, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect([10, 194, 195].map((x) => laneAt(x, 0, 390, 2))).toEqual([0, 0, 1]);
    expect(laneAt(-5, 0, 390, 4)).toBe(0);
    expect(laneAt(400, 0, 390, 4)).toBe(3);
    expect(laneAt(500, 100, 390, 1)).toBe(0);
  });

  it('maps D F J K to four lanes and the home row halves to two', () => {
    expect(['KeyD', 'KeyF', 'KeyJ', 'KeyK'].map((k) => keyLane(k, 4))).toEqual([0, 1, 2, 3]);
    expect(['KeyD', 'KeyF', 'KeyJ', 'KeyK'].map((k) => keyLane(k, 2))).toEqual([0, 0, 1, 1]);
    expect(keyLane('Space', 4)).toBeNull();
    expect(keyLane('KeyF', 1)).toBeNull();
  });

  it('reads a quick upward swipe as a flick, and nothing else', () => {
    expect(isFlick(4, -FLICK_PX, 80)).toBe(true);
    expect(isFlick(0, -FLICK_PX + 1, 80)).toBe(false);
    expect(isFlick(0, FLICK_PX * 2, 80)).toBe(false);
    expect(isFlick(FLICK_PX * 2, -FLICK_PX, 80)).toBe(false);
    expect(isFlick(0, -FLICK_PX * 2, FLICK_MS + 1)).toBe(false);
  });
});

describe('hold notes', () => {
  it('makes every note of a beat and a half or longer a hold', () => {
    expect(holdNotes([note(60, 1), note(62, 1.5), rest(2), note(64, 4)])).toEqual([false, true, false, true]);
  });

  it('keeps the grade inside the grace, drops a step when let go early, misses before halfway', () => {
    expect(releaseJudgement('perfect', HOLD_RELEASE_MS, 1000)).toBe('perfect');
    expect(releaseJudgement('perfect', -500, 1000)).toBe('perfect');
    expect(releaseJudgement('perfect', HOLD_RELEASE_MS + 1, 1000)).toBe('great');
    expect(releaseJudgement('great', 300, 1000)).toBe('good');
    expect(releaseJudgement('good', 300, 1000)).toBe('miss');
    expect(releaseJudgement('perfect', 501, 1000)).toBe('miss');
  });

  it('rescores the note and breaks the combo without adding a note', () => {
    const before = record(record(emptyTally(), 'perfect'), 'perfect');
    const after = regrade(before, 'perfect', 'great');
    expect(after.notes).toBe(2);
    expect(after.perfect).toBe(1);
    expect(after.great).toBe(1);
    expect(after.combo).toBe(0);
    expect(after.bestCombo).toBe(2);
    expect(after.accuracy).toBeCloseTo(87.5);
    expect(regrade(before, 'perfect', 'miss').accuracy).toBeCloseTo(50);
    expect(regrade(emptyTally(), 'perfect', 'miss')).toEqual(emptyTally());
  });
});

describe('flick notes', () => {
  it('marks a bar’s first note when it is a strong accent, at most once a bar', () => {
    // Average velocity about 77: 100 clears the margin, 85 does not.
    const events = [note(60, 1, 100), note(62, 1, 100), note(64, 2, 60), rest(4), note(65, 1, 85), note(67, 3, 75), note(69, 1, 60), note(71, 1, 60), rest(2)];
    const flicks = flickNotes(events, 4);
    expect(flicks).toEqual([true, false, false, false, false, false, false, false, false]);
    expect(ACCENT_MARGIN).toBeGreaterThan(0);
  });

  it('only counts the first note of the bar, never a hold, and none in an even part', () => {
    expect(flickNotes([note(60, 1, 60), note(62, 1, 127), note(64, 2, 60)], 4)).toEqual([false, false, false]);
    expect(flickNotes([note(60, 2, 127), note(62, 2, 40)], 4)).toEqual([false, false]);
    expect(flickNotes([note(60, 4), note(62, 4), note(64, 4)], 4)).toEqual([false, false, false]);
  });

  it('caps a plain tap on a flick at Good and lets a flick keep its timing grade', () => {
    expect(flickJudgement('perfect', false)).toBe('good');
    expect(flickJudgement('great', false)).toBe('good');
    expect(flickJudgement('good', false)).toBe('good');
    expect(flickJudgement('miss', false)).toBe('miss');
    expect(flickJudgement('perfect', true)).toBe('perfect');
    expect(flickJudgement('miss', true)).toBe('miss');
  });
});

describe('levels', () => {
  const memory = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };

  it('defaults to Normal with nothing saved, junk saved, or storage blocked', () => {
    expect(DEFAULT_LEVEL).toBe('normal');
    expect(loadLevel(memory())).toBe('normal');
    expect(loadLevel(memory({ [LEVEL_PREF]: 'impossible' }))).toBe('normal');
    expect(loadLevel(broken)).toBe('normal');
    expect(loadLevel(null)).toBe('normal');
    expect(loadLevel()).toBe('normal');
  });

  it('remembers the chosen level', () => {
    const prefs = memory();
    saveLevel('expert', prefs);
    expect(prefs.data.get(LEVEL_PREF)).toBe('expert');
    expect(loadLevel(prefs)).toBe('expert');
    expect(() => saveLevel('hard', broken)).not.toThrow();
  });

  it('sets lanes, speed and note types per level', () => {
    expect((['easy', 'normal', 'hard', 'expert'] as const).map(laneCount)).toEqual([1, 2, 4, 4]);
    expect(lookahead('expert')).toBeLessThan(lookahead('hard'));
    expect(noteTypes('expert')).toBe(true);
    expect(noteTypes('hard')).toBe(false);
  });
});

describe('lane tints', () => {
  it('shades a colour lighter and darker', () => {
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(shade('var(--x)', 0.3)).toBe('var(--x)');
  });

  it('gives every lane its own shade of the instrument colour', () => {
    const tints = laneTints('#ff4f1f', 4);
    expect(tints).toHaveLength(4);
    expect(new Set(tints).size).toBe(4);
    expect(laneTints('#ff4f1f', 2)).toHaveLength(2);
  });
});
