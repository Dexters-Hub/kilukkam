import { getPiece } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { CAMDEMO_MS, demoHands } from '../src/lib/camera/camdemo.js';
import { createConductor, type ConductorCue, type ConductorOptions } from '../src/lib/camera/conductor.js';
import { messagesFor, sectionsFor } from '../src/features/stage/gestureActions.js';
const LEVELS = ['pp', 'p', 'mf', 'f', 'ff'];
import { POSES, clock, frame, makeHand, rng, type Placement, type Pose } from './hand-fixtures.js';

// The camera conductor controls a live room; no gesture may end the piece.
// Root cause of the owner's bug: a fist (or a hand that reads as one) right
// after the camera started was a cut-off, and the stage turned it into stop_piece.

const run = (frames: Iterable<ReturnType<typeof frame>>, opts: ConductorOptions = {}) => {
  const cues: ConductorCue[] = [];
  const c = createConductor((cue) => cues.push(cue), opts);
  for (const f of frames) c.push(f);
  return { cues, kinds: cues.map((q) => q.kind) as string[] };
};

function* holding(pose: Pose, ms: number, at: Placement & { start?: number; seed?: number } = {}) {
  const random = rng(at.seed ?? 3);
  for (const t of clock(ms, { jitter: 6, random, start: at.start ?? 0 })) yield frame(t, makeHand(pose, { noise: 0.002, random, ...at }));
}

describe('camera start never ends the piece', () => {
  it('ignores a closed hand that comes into view as the camera starts', () => {
    const r = run(holding(POSES.fist, 2500));
    expect(r.kinds).not.toContain('cutoff');
    expect(r.kinds).not.toContain('pause');
  });

  it('ignores a fist made in the first 3 s after the camera starts', () => {
    const r = run([...holding(POSES.open, 1000), ...holding(POSES.fist, 1800, { start: 1033 })]);
    expect(r.kinds).not.toContain('cutoff');
    expect(r.kinds).not.toContain('pause');
  });
});

// ---------- every gesture, and the accidents each must ignore ----------

type Frames = ReturnType<typeof frame>[];
const of = (r: ReturnType<typeof run>, kind: ConductorCue['kind']) => r.cues.filter((c) => c.kind === kind);
const hand = (pose: Pose, at: Placement, random = rng(9)) => makeHand(pose, { noise: 0.002, random, ...at });
/** Frames over `ms` from `start`, each built by `make(t)` */
const over = (ms: number, start: number, make: (t: number) => ReturnType<typeof makeHand>[]): Frames =>
  [...clock(ms, { start })].map((t) => frame(t, ...make(t)));
/** A palm held up to the ceiling or down to the floor: fingers sideways, towards the middle */
const flatAt = (x: number, y: number, handedness: 'left' | 'right') => hand(POSES.open, { x, y, rotate: handedness === 'left' ? 90 : -90, handedness });
const stopAt = (x: number, y: number, handedness: 'left' | 'right' = 'right') => hand(POSES.open, { x, y, handedness });
/** Both hands, left at x 0.3 and right at x 0.7 */
const pair = (pose: Pose, yl: number, yr = yl) => [hand(pose, { x: 0.3, y: yl, handedness: 'left' }), hand(pose, { x: 0.7, y: yr, handedness: 'right' })];
const flatPair = (yl: number, yr = yl) => [flatAt(0.3, yl, 'left'), flatAt(0.7, yr, 'right')];
/** Gesture detectors without the camera's 3 s arming time (tested on its own below) */
const NOW = { armMs: 0 };
const bounce = (t: number, bpm: number, amp = 0.3, top = 0.35) => top + amp * (1 - Math.abs(Math.sin((Math.PI * t) / (60_000 / bpm))));
/** A conductor beating with both hands, mirrored */
const mirrored = (bpm: number, beats: number, make: (y: number) => ReturnType<typeof makeHand>[]): Frames => over((beats * 60_000) / bpm, 0, (t) => make(bounce(t, bpm)));
const notable = (r: ReturnType<typeof run>) => r.kinds.filter((k) => k !== 'beat' && k !== 'dynamics' && k !== 'tempo');

describe('arming', () => {
  it('ignores every gesture but the beat for the first 3 s after the camera starts', () => {
    const r = run(over(2900, 0, () => [stopAt(0.3, 0.45, 'left'), stopAt(0.7, 0.45)]));
    expect(notable(r)).toEqual([]);
    expect(of(run(over(4500, 0, () => [stopAt(0.3, 0.45, 'left'), stopAt(0.7, 0.45)])), 'pause')).toHaveLength(1);
  });

  it('ignores a hand that came into view under 500 ms ago', () => {
    const away = over(4000, 0, () => [stopAt(0.85, 0.45)]);
    // A second palm appears: no pause until it has been in view 500 ms, then the 0.8 s hold.
    const r = run([...away, ...over(1200, 4033, () => [stopAt(0.3, 0.45, 'left'), stopAt(0.85, 0.45)])]);
    for (const p of of(r, 'pause')) expect(p.t).toBeGreaterThanOrEqual(4033 + 500 + 800);
  });
});

describe('pause and resume', () => {
  it('pauses on both stop hands held 0.8 s, once', () => {
    const r = run(over(3000, 0, () => [stopAt(0.3, 0.45, 'left'), stopAt(0.7, 0.45)]), NOW);
    expect(of(r, 'pause')).toHaveLength(1);
    expect(of(r, 'pause')[0]?.t).toBeGreaterThanOrEqual(500 + 800);
    expect(of(r, 'rest')).toHaveLength(0);
  });

  it('never pauses on a fist, two relaxed hands, or palms still rising into place', () => {
    expect(notable(run(over(4000, 0, () => pair(POSES.fist, 0.5)), NOW))).toEqual([]);
    expect(notable(run(over(4000, 0, () => pair(POSES.relaxed, 0.5)), NOW))).toEqual([]);
    const rising = over(3000, 0, (t) => [stopAt(0.3, 0.8 - (0.45 * t) / 3000, 'left'), stopAt(0.7, 0.8 - (0.45 * t) / 3000)]);
    expect(of(run(rising, NOW), 'pause')).toHaveLength(0);
  });

  it('resumes on one big downbeat, not on small beats or open palms', () => {
    const paused = (frames: Frames) => {
      const cues: ConductorCue[] = [];
      const c = createConductor((q) => cues.push(q), NOW);
      c.paused = true;
      for (const f of frames) c.push(f);
      return cues.map((q) => q.kind);
    };
    const big = [...over(500, 0, () => [hand(POSES.relaxed, { x: 0.6, y: 0.3 })]), ...over(250, 533, (t) => [hand(POSES.relaxed, { x: 0.6, y: 0.3 + (0.45 * (t - 533)) / 250 })]), ...over(400, 800, (t) => [hand(POSES.relaxed, { x: 0.6, y: 0.75 - (0.2 * (t - 800)) / 400 })])];
    expect(paused(big)).toContain('resume');
    expect(paused(over(4000, 0, (t) => [hand(POSES.relaxed, { x: 0.6, y: bounce(t, 100, 0.08, 0.5) })]))).not.toContain('resume');
    expect(paused(over(3000, 0, () => [stopAt(0.3, 0.45, 'left'), stopAt(0.7, 0.45)]))).not.toContain('resume');
  });
});

describe('section rest', () => {
  it('rests the section a single stop hand is held in, after 1 s', () => {
    for (const [x, side] of [[0.15, 'left'], [0.5, 'center'], [0.85, 'right']] as const) {
      const r = run(over(2200, 0, () => [stopAt(x, 0.5)]), NOW);
      expect(of(r, 'rest').map((c) => (c.kind === 'rest' ? c.side : null))).toEqual([side]);
      expect(of(r, 'rest')[0]?.t).toBeGreaterThanOrEqual(500 + 1000);
    }
  });

  it('ignores a hand waving hello, a palm hanging down, and a relaxed hand', () => {
    const wave = over(3000, 0, (t) => [stopAt(0.5 + 0.15 * Math.sin((t / 1000) * 3 * Math.PI), 0.4)]);
    expect(notable(run(wave, NOW))).toEqual([]);
    expect(notable(run(over(3000, 0, () => [hand(POSES.open, { x: 0.5, y: 0.5, rotate: 180 })]), NOW))).toEqual([]);
    expect(run(over(8000, 0, () => [hand(POSES.relaxed, { x: 0.5, y: 0.6 })])).cues).toHaveLength(0);
  });

  it('does not rest while the room is paused', () => {
    const cues: ConductorCue[] = [];
    const c = createConductor((q) => cues.push(q), NOW);
    c.paused = true;
    for (const f of over(3000, 0, () => [stopAt(0.85, 0.5)])) c.push(f);
    expect(cues.map((q) => q.kind)).not.toContain('rest');
  });
});

describe('dynamics from the off-hand', () => {
  /** The baton hand waits on the right (the camdemo test covers it beating meanwhile); the off-hand is flat on the left */
  const withBaton = (ms: number, start: number, off: (t: number) => ReturnType<typeof makeHand>) =>
    over(ms, start, (t) => [off(t), hand(POSES.relaxed, { x: 0.7, y: 0.5, handedness: 'right' })]);
  const steps = (offY: (t: number) => number) => {
    const cues: ConductorCue[] = [];
    const c = createConductor((q) => cues.push(q), NOW);
    for (const f of withBaton(600, 0, () => flatAt(0.25, offY(0), 'left'))) c.push(f);
    c.dynamics = 'mf';
    for (const f of withBaton(1500, 633, (t) => flatAt(0.25, offY(t - 633), 'left'))) c.push(f);
    return cues.flatMap((q) => (q.kind === 'dynamics' && q.t > 633 ? [q.level] : []));
  };

  it('lifting the flat palm is one step louder, pressing it down one step softer', () => {
    expect(steps((t) => 0.65 - Math.min(0.2, (0.2 * t) / 800))).toEqual(['f']);
    expect(steps((t) => 0.45 + Math.min(0.2, (0.2 * t) / 800))).toEqual(['p']);
  });

  it('ignores a flat hand held still, a flat hand flung, and a stop hand moving', () => {
    expect(steps(() => 0.5)).toEqual([]);
    expect(steps((t) => 0.7 - Math.min(0.5, (0.5 * t) / 150))).toEqual([]);
    const r = run(withBaton(2000, 0, (t) => stopAt(0.25, 0.65 - Math.min(0.2, (0.2 * t) / 800), 'left')), NOW);
    expect(r.cues.filter((q) => q.kind === 'dynamics' && q.t > 300)).toHaveLength(0);
  });
});

describe('build', () => {
  it('fires once when both palms rise slowly together', () => {
    const r = run([...over(600, 0, () => flatPair(0.75)), ...over(2000, 633, (t) => flatPair(0.75 - (0.4 * (t - 633)) / 2000))], NOW);
    expect(of(r, 'build')).toHaveLength(1);
    expect(of(r, 'dynamics')).toHaveLength(0);
  });

  it('ignores mirrored two-handed beating at any tempo, a fast fling up, and stop hands rising', () => {
    for (const bpm of [40, 60, 100, 140]) {
      const r = run(mirrored(bpm, 8, (y) => flatPair(y)), NOW);
      expect(of(r, 'build')).toHaveLength(0);
      expect(of(r, 'drop')).toHaveLength(0);
    }
    const fling = run([...over(600, 0, () => flatPair(0.8)), ...over(250, 633, (t) => flatPair(0.8 - (0.5 * (t - 633)) / 250)), ...over(800, 900, () => flatPair(0.3))], NOW);
    expect(of(fling, 'build')).toHaveLength(0);
    const stops = run(over(2600, 0, (t) => [stopAt(0.3, 0.75 - Math.min(0.4, (0.4 * t) / 2000), 'left'), stopAt(0.7, 0.75 - Math.min(0.4, (0.4 * t) / 2000))]), NOW);
    expect(of(stops, 'build')).toHaveLength(0);
  });
});

describe('drop', () => {
  const sweep = (start: number, fall = 0.45, ms = 300): Frames => [
    ...over(800, start, () => pair(POSES.relaxed, 0.3)),
    ...over(ms, start + 833, (t) => pair(POSES.relaxed, 0.3 + (fall * (t - start - 833)) / ms)),
    ...over(700, start + 833 + ms + 33, () => pair(POSES.relaxed, 0.3 + fall)),
  ];

  it('fires once when both hands sweep down fast together', () => {
    expect(of(run(sweep(0), NOW), 'drop')).toHaveLength(1);
  });

  it('ignores a slow lowering of the hands, one hand sweeping, and mirrored beating', () => {
    expect(of(run(sweep(0, 0.45, 1500), NOW), 'drop')).toHaveLength(0);
    const one = [...over(800, 0, () => [hand(POSES.relaxed, { x: 0.6, y: 0.3 })]), ...over(300, 833, (t) => [hand(POSES.relaxed, { x: 0.6, y: 0.3 + (0.45 * (t - 833)) / 300 })]), ...over(700, 1166, () => [hand(POSES.relaxed, { x: 0.6, y: 0.75 })])];
    expect(of(run(one, NOW), 'drop')).toHaveLength(0);
    for (const bpm of [60, 100, 140]) expect(of(run(mirrored(bpm, 8, (y) => pair(POSES.relaxed, y)), NOW), 'drop')).toHaveLength(0);
  });
});

describe('loop bar', () => {
  /** The fingertip traces a circle of `r` frame heights, `turnMs` a turn, from `start` */
  const tracing = (ms: number, start: number, r = 0.08, turnMs = 1000) =>
    over(ms, start, (t) => {
      const a = ((t - start) / turnMs) * 2 * Math.PI;
      const probe = hand(POSES.point, { x: 0.3, y: 0.5, handedness: 'left' });
      const dx = probe.indexTip.x - probe.palmCenter.x;
      const dy = probe.indexTip.y - probe.palmCenter.y;
      return [hand(POSES.point, { x: 0.3 + r * Math.cos(a) * 0.75 - dx, y: 0.45 + r * Math.sin(a) - dy, handedness: 'left' }), hand(POSES.relaxed, { x: 0.72, y: 0.6 })];
    });

  it('toggles once per circle drawn with the index finger', () => {
    const r = run([...over(600, 0, () => [hand(POSES.point, { x: 0.3, y: 0.5, handedness: 'left' }), hand(POSES.relaxed, { x: 0.72, y: 0.6 })]), ...tracing(1300, 633)], NOW);
    expect(of(r, 'loop')).toHaveLength(1);
    expect(of(r, 'cue')).toHaveLength(0);
  });

  it('ignores a tiny circle, a slow one, a finger moving in a line, and a finger held still', () => {
    expect(of(run(tracing(3000, 0, 0.01), NOW), 'loop')).toHaveLength(0);
    expect(of(run(tracing(3000, 0, 0.08, 4000), NOW), 'loop')).toHaveLength(0);
    const line = over(3000, 0, (t) => [hand(POSES.point, { x: 0.3 + 0.08 * Math.sin(t / 150), y: 0.5, handedness: 'left' }), hand(POSES.relaxed, { x: 0.72, y: 0.6 })]);
    expect(of(run(line, NOW), 'loop')).toHaveLength(0);
    const still = run(over(2500, 0, () => [hand(POSES.point, { x: 0.3, y: 0.5, handedness: 'left' }), hand(POSES.relaxed, { x: 0.72, y: 0.6 })]), NOW);
    expect(of(still, 'loop')).toHaveLength(0);
  });
});

describe('Kilukkam!', () => {
  const shake = (ms: number, start: number, hz = 4, amp = 0.04) => over(ms, start, (t) => [hand(POSES.relaxed, { x: 0.55 + amp * Math.sin(((t - start) / 1000) * hz * 2 * Math.PI), y: 0.5 })]);

  it('rings on a quick side to side shake, at most once in 3 s', () => {
    const r = run([...over(600, 0, () => [hand(POSES.relaxed, { x: 0.55, y: 0.5 })]), ...shake(2000, 633)], NOW);
    expect(of(r, 'kilukkam')).toHaveLength(1);
    expect(of(r, 'kilukkam')[0]?.t).toBeLessThan(633 + 800);
  });

  it('ignores waving hello, scratching your face, and a relaxed hand', () => {
    expect(of(run(shake(3000, 0, 1.5, 0.15), NOW), 'kilukkam')).toHaveLength(0);
    const random = rng(21);
    const scratch = over(4000, 0, (t) => [hand(Math.floor(t / 150) % 2 ? POSES.fist : POSES.relaxed, { x: 0.5 + 0.01 * Math.sin(t / 25), y: 0.2 + 0.01 * Math.cos(t / 30), rotate: 160 }, random)]);
    expect(notable(run(scratch, NOW))).toEqual([]);
    expect(of(run(over(4000, 0, () => [hand(POSES.relaxed, { x: 0.5, y: 0.6 })]), NOW), 'kilukkam')).toHaveLength(0);
  });
});

describe('gestures to room messages', () => {
  const piece = getPiece('canon-in-d');
  if (!piece) throw new Error('canon-in-d missing');
  const room = { sections: sectionsFor(piece), playAlong: false, paused: false, looping: false };
  const all: ConductorCue[] = [
    { kind: 'beat', t: 0, bpm: 90, size: 0.5 },
    { kind: 'tempo', t: 0, bpm: 92 },
    { kind: 'dynamics', t: 0, level: 'ff' },
    { kind: 'cue', t: 0, side: 'left' },
    { kind: 'rest', t: 0, side: 'right' },
    { kind: 'pause', t: 0 },
    { kind: 'resume', t: 0 },
    { kind: 'build', t: 0 },
    { kind: 'drop', t: 0 },
    { kind: 'loop', t: 0 },
  ];

  it('never ends the piece, whatever the room state', () => {
    for (const paused of [false, true]) {
      for (const looping of [false, true]) {
        for (const cue of all) expect(messagesFor(cue, { ...room, paused, looping }).map((m) => m.type)).not.toContain('stop_piece');
      }
    }
  });

  it('rests and brings in whole sections, pauses and resumes the room, and toggles the loop', () => {
    expect(messagesFor({ kind: 'rest', t: 0, side: 'right' }, room)).toEqual([{ type: 'set_section', trackId: 'cello', muted: true }]);
    expect(messagesFor({ kind: 'cue', t: 0, side: 'right' }, room)).toEqual([{ type: 'set_section', trackId: 'cello', muted: false }]);
    expect(messagesFor({ kind: 'pause', t: 0 }, room)).toEqual([{ type: 'pause_piece' }]);
    expect(messagesFor({ kind: 'resume', t: 0 }, { ...room, paused: true })).toEqual([{ type: 'resume_piece' }]);
    expect(messagesFor({ kind: 'loop', t: 0 }, { ...room, looping: true })).toEqual([{ type: 'dj', cue: 'loop_off' }]);
    expect(messagesFor({ kind: 'tempo', t: 0, bpm: 92 }, { ...room, playAlong: true })).toEqual([]);
  });
});

describe('?camdemo', () => {
  it('performs all ten gestures in order, and none of them ends the piece', () => {
    const cues: ConductorCue[] = [];
    const c = createConductor((q) => cues.push(q), { tempo: 72 });
    for (let e = 0; e <= CAMDEMO_MS; e += 1000 / 30) {
      const hands = demoHands(e);
      if (!hands) break;
      c.push(frame(e, ...hands));
    }
    const said = cues
      .filter((q) => q.kind !== 'beat' && q.kind !== 'dynamics' && q.kind !== 'tempo')
      .map((q) => (q.kind === 'cue' || q.kind === 'rest' ? `${q.kind}:${q.side}` : q.kind));
    expect(said).toEqual(['cue:left', 'rest:right', 'pause', 'resume', 'build', 'drop', 'loop', 'loop', 'kilukkam', 'cue:right']);
    const tempos = cues.flatMap((q) => (q.kind === 'tempo' ? [q] : []));
    expect(tempos.some((q) => Math.abs(q.bpm - 120) <= 4 && q.t < 8000)).toBe(true);
    expect(tempos.some((q) => Math.abs(q.bpm - 90) <= 4 && q.t > 8000 && q.t < 16_000)).toBe(true);
    expect(tempos.some((q) => Math.abs(q.bpm - 100) <= 4 && q.t > 34_500)).toBe(true);
    // No gesture stroke (the drop's sweep, the resume downbeat, the circle) is read as a tempo.
    for (const q of tempos) expect(q.bpm).toBeGreaterThanOrEqual(86);
    // The palm steps: one up, then one down, while the baton keeps time.
    const palm = cues.flatMap((q) => (q.kind === 'dynamics' && q.t > 13_000 && q.t < 16_000 ? [q.level] : []));
    expect(palm).toHaveLength(2);
    expect(LEVELS.indexOf(palm[0] ?? 'mf')).toBeGreaterThan(LEVELS.indexOf(palm[1] ?? 'mf'));
  });
});
