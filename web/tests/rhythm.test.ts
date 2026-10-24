import { note, rest } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { ServerClock, estimate, measure } from '../src/lib/clock.js';
import { BeatGrid, emptyTally, grade, judge, onsets, record } from '../src/lib/rhythm.js';

describe('clock', () => {
  it('measures offset from the midpoint of the round trip', () => {
    expect(measure({ sent: 1000, server: 5020, received: 1040 })).toEqual({ offset: 4000, rtt: 40 });
  });
  it('trusts the fastest round trips', () => {
    const e = estimate([
      { sent: 0, server: 4005, received: 10 }, // rtt 10, offset 4000
      { sent: 100, server: 4300, received: 300 }, // rtt 200, offset 4100 (noisy)
      { sent: 400, server: 4406, received: 412 }, // rtt 12, offset 4000
    ]);
    expect(e?.offset).toBeCloseTo(4000, 0);
    expect(e?.rtt).toBe(10);
  });
  it('maps between local and server time', () => {
    let local = 1000;
    const clock = new ServerClock(() => local);
    expect(clock.ready).toBe(false);
    clock.add(980, 6000, 1000);
    expect(clock.ready).toBe(true);
    expect(clock.now()).toBeCloseTo(6010, 0);
    expect(clock.toLocal(7010)).toBeCloseTo(2000, 0);
    local = 1500;
    expect(clock.now()).toBeCloseTo(6510, 0);
  });
});

describe('BeatGrid', () => {
  it('maps beats and time at a fixed tempo, with a count-in before beat 0', () => {
    const g = new BeatGrid(10_000, 120);
    expect(g.timeOf(0)).toBe(10_000);
    expect(g.timeOf(4)).toBe(12_000);
    expect(g.beatAt(11_000)).toBe(2);
    expect(g.beatAt(8_000)).toBe(-4);
  });
  it('adopts a server tempo anchor so every phone re-times identically', () => {
    const g = new BeatGrid(0, 60);
    g.anchor({ at: 8000, beat: 8, bpm: 120 });
    expect(g.timeOf(10)).toBeCloseTo(9000);
    expect(g.beatAt(4000)).toBeCloseTo(4); // before the anchor, the old tempo still holds
  });
  it('changes tempo without the grid jumping', () => {
    const g = new BeatGrid(0, 60);
    g.setTempo(120, 4000); // beat 4 reached at 4 s, then twice as fast
    expect(g.beatAt(4000)).toBeCloseTo(4);
    expect(g.timeOf(6)).toBeCloseTo(5000);
    expect(g.timeOf(2)).toBeCloseTo(2000); // the past is unchanged
    expect(g.bpm).toBe(120);
  });
});

describe('onsets', () => {
  it('includes rests so canon entries stay offset', () => {
    expect(onsets([rest(8), note(78, 2), note(76, 2)])).toEqual([0, 8, 10]);
  });
});

describe('judge + tally', () => {
  it('judges by distance from the note', () => {
    expect(judge(-30)).toBe('perfect');
    expect(judge(90)).toBe('great');
    expect(judge(-160)).toBe('good');
    expect(judge(400)).toBe('miss');
  });
  it('tracks combo, best combo and accuracy', () => {
    let t = emptyTally();
    for (const j of ['perfect', 'perfect', 'miss', 'great'] as const) t = record(t, j);
    expect(t).toMatchObject({ notes: 4, perfect: 2, miss: 1, great: 1, combo: 1, bestCombo: 2 });
    expect(t.accuracy).toBeCloseTo((100 + 100 + 0 + 75) / 4);
  });
  it('grades accuracy weighted by how much of the part you played', () => {
    expect(grade(95, 1)).toBe('S');
    expect(grade(95, 0.5)).toBe('C');
    expect(grade(80, 1)).toBe('A');
  });
});
