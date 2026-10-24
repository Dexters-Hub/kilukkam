import { describe, expect, it } from 'vitest';
import { createAirPlay, type AirCue } from '../src/lib/camera/air.js';
import { createConductor, HoldGate, isPointing, refineIctus, sideFor, type ConductorCue, type ConductorOptions } from '../src/lib/camera/conductor.js';
import { analyseHand, handSize } from '../src/lib/camera/features.js';
import { OneEuroFilter } from '../src/lib/camera/filter.js';
import { ASPECT, POSES, bounceY, clock, fingersPose, frame, makeHand, rng, type Placement, type Pose } from './hand-fixtures.js';

// ---------- features ----------

describe('analyseHand', () => {
  it('reads the basic shapes', () => {
    const open = makeHand(POSES.open);
    expect(open.fingersUp).toEqual([true, true, true, true, true]);
    expect(open.openPalm).toBe(true);
    expect(open.fist).toBe(false);

    const fist = makeHand(POSES.fist);
    expect(fist.fingersUp.slice(1)).toEqual([false, false, false, false]);
    expect(fist.fist).toBe(true);

    expect(isPointing(makeHand(POSES.point))).toBe(true);
    expect(makeHand(POSES.pinch).pinch).toBe(true);
    expect(open.pinch).toBe(false);
  });

  it('reads a loose, relaxed hand as neither up nor a fist', () => {
    const relaxed = makeHand(POSES.relaxed);
    expect(relaxed.fingersUp.slice(1)).toEqual([false, false, false, false]);
    expect(relaxed.fist).toBe(false);
  });

  it('gives the same answers at any distance and any angle', () => {
    for (const size of [0.05, 0.12, 0.3]) {
      for (const rotate of [-90, -30, 0, 45, 90]) {
        for (const pose of [POSES.open, POSES.fist, POSES.point, POSES.pinch]) {
          const ref = makeHand(pose);
          const h = makeHand(pose, { size, rotate });
          expect(h.fingersUp).toEqual(ref.fingersUp);
          expect(h.fist).toBe(ref.fist);
          expect(h.pinch).toBe(ref.pinch);
          expect(h.size / size).toBeCloseTo(1, 2);
        }
      }
    }
  });

  it('mirrors x for the selfie preview and names the real hand', () => {
    const raw = makeHand(POSES.open, { x: 0.2 }).landmarks.map((p) => ({ x: 1 - p.x, y: p.y }));
    const mirrored = analyseHand(raw, 'Left', 0.9, { aspect: ASPECT, mirror: true });
    const plain = analyseHand(raw, 'Left', 0.9, { aspect: ASPECT, mirror: false });
    expect(mirrored?.palmCenter.x).toBeCloseTo(0.2, 5);
    expect(plain?.palmCenter.x).toBeCloseTo(0.8, 5);
    // MediaPipe assumes a mirrored image; on the raw camera frame "Left" is the right hand.
    expect(mirrored?.handedness).toBe('right');
    expect(analyseHand(raw.slice(0, 20), 'Left', 0.9, { aspect: ASPECT, mirror: true })).toBeNull();
  });

  it('keeps the size estimate when the palm turns sideways', () => {
    const lms = makeHand(POSES.open).landmarks;
    // Squash the hand horizontally as if seen edge on: the length still carries the size.
    const edgeOn = lms.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.3, y: p.y }));
    expect(handSize(edgeOn, ASPECT)).toBeGreaterThan(0.1);
    // Squash it vertically as if tipped towards the camera: the width carries it.
    const tipped = lms.map((p) => ({ x: p.x, y: 0.5 + (p.y - 0.5) * 0.3 }));
    expect(handSize(tipped, ASPECT)).toBeGreaterThan(0.09);
  });
});

describe('OneEuroFilter', () => {
  it('steadies a still hand and keeps up with a moving one', () => {
    const r = rng(1);
    const f = new OneEuroFilter();
    let maxDev = 0;
    for (const t of clock(2000)) maxDev = Math.max(maxDev, Math.abs(f.filter(0.5 + 0.004 * r(), t) - 0.5));
    expect(maxDev).toBeLessThan(0.0025);

    const g = new OneEuroFilter();
    let lag = 0;
    for (const t of clock(1000)) {
      const y = 0.2 + 0.6 * (t / 1000); // 0.6 frame heights a second
      lag = y - g.filter(y, t);
    }
    expect(lag).toBeLessThan(0.02);
  });
});

// ---------- conductor ----------

interface Run {
  cues: ConductorCue[];
  of<K extends ConductorCue['kind']>(kind: K): Extract<ConductorCue, { kind: K }>[];
}

const run = (frames: Iterable<ReturnType<typeof frame>>, opts: ConductorOptions = {}): Run => {
  const cues: ConductorCue[] = [];
  const c = createConductor((cue) => cues.push(cue), opts);
  for (const f of frames) c.push(f);
  return {
    cues,
    of: <K extends ConductorCue['kind']>(kind: K) => cues.filter((q): q is Extract<ConductorCue, { kind: K }> => q.kind === kind),
  };
};

interface Beating {
  bpm: number;
  beats: number;
  amp?: number;
  size?: number;
  pose?: Pose;
  start?: number;
  seed?: number;
  /** Extra steady hands in view */
  others?: (t: number) => ReturnType<typeof makeHand>[];
  at?: Placement;
}

/** A conductor beating time at 30 fps with camera timing jitter and landmark noise */
function* beating(b: Beating): Generator<ReturnType<typeof frame>> {
  const random = rng(b.seed ?? 7);
  const size = b.size ?? 0.12;
  const amp = b.amp ?? 0.3;
  for (const t of clock((b.beats * 60_000) / b.bpm, { jitter: 6, random, start: b.start ?? 0 })) {
    const hand = makeHand(b.pose ?? POSES.open, { x: 0.6, y: bounceY(t - (b.start ?? 0), b.bpm, amp), size, noise: 0.002, random, ...b.at });
    yield frame(t, hand, ...(b.others?.(t) ?? []));
  }
}

/** One hand holding a pose, nearly still */
function* holding(pose: Pose, ms: number, at: Placement & { start?: number; seed?: number } = {}): Generator<ReturnType<typeof frame>> {
  const random = rng(at.seed ?? 3);
  for (const t of clock(ms, { jitter: 6, random, start: at.start ?? 0 })) yield frame(t, makeHand(pose, { noise: 0.002, random, ...at }));
}

describe('conductor tempo', () => {
  for (const bpm of [70, 100, 140]) {
    it(`follows a beat at ${bpm} bpm to within 4 bpm`, () => {
      const r = run(beating({ bpm, beats: 16 }));
      const beats = r.of('beat');
      expect(beats.length).toBeGreaterThanOrEqual(15);
      expect(beats.length).toBeLessThanOrEqual(17);
      const tempo = r.of('tempo');
      expect(tempo.length).toBeGreaterThanOrEqual(1);
      const last = tempo[tempo.length - 1];
      expect(Math.abs((last?.bpm ?? 0) - bpm)).toBeLessThanOrEqual(4);
      for (const b of beats.slice(4)) expect(Math.abs((b.bpm ?? 0) - bpm)).toBeLessThanOrEqual(4);
    });
  }

  it('stays within 4 bpm across many hands, and when a slow device drops to 15 fps', () => {
    for (const fps of [30, 15]) {
      for (const bpm of [70, 100, 140]) {
        for (let seed = 1; seed <= 10; seed++) {
          const random = rng(seed);
          const frames = [...clock((16 * 60_000) / bpm, { fps, jitter: 6, random })].map((t) =>
            frame(t, makeHand(POSES.open, { x: 0.6, y: bounceY(t, bpm, 0.25), noise: 0.003, random })),
          );
          const tempo = run(frames).of('tempo');
          expect(Math.abs((tempo[tempo.length - 1]?.bpm ?? 0) - bpm)).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('places the ictus between frames', () => {
    // A V with its point at t = 40, sampled at 0, 33 and 66 ms.
    const v = (t: number) => 0.6 - Math.abs(t - 40) * 0.002;
    expect(refineIctus([{ t: 0, y: v(0) }, { t: 33, y: v(33) }, { t: 66, y: v(66) }], 33)).toBeCloseTo(40, 0);
    expect(refineIctus([{ t: 0, y: 0.5 }, { t: 33, y: 0.4 }, { t: 66, y: 0.5 }], 33)).toBe(33);
  });

  it('says the tempo once for a steady beat, and at most once a bar when it changes', () => {
    const steady = run(beating({ bpm: 100, beats: 24 }));
    expect(steady.of('tempo')).toHaveLength(1);

    const speeding = run([...beating({ bpm: 90, beats: 12 }), ...beating({ bpm: 130, beats: 16, start: 8000 })]);
    const tempo = speeding.of('tempo');
    const last = tempo[tempo.length - 1];
    expect(Math.abs((last?.bpm ?? 0) - 130)).toBeLessThanOrEqual(4);
    const beatTimes = speeding.of('beat').map((b) => b.t);
    for (let i = 1; i < tempo.length; i++) {
      const between = beatTimes.filter((t) => t > (tempo[i - 1]?.t ?? 0) && t <= (tempo[i]?.t ?? 0)).length;
      expect(between).toBeGreaterThanOrEqual(4);
    }
  });

  it('compares the first reading with the written tempo', () => {
    expect(run(beating({ bpm: 101, beats: 12 }), { tempo: 100 }).of('tempo')).toHaveLength(0);
    const slower = run(beating({ bpm: 80, beats: 12 }), { tempo: 100 }).of('tempo');
    expect(Math.abs((slower[0]?.bpm ?? 0) - 80)).toBeLessThanOrEqual(4);
  });

  it('ignores a hand that only trembles', () => {
    expect(run(holding(POSES.open, 3000)).of('beat')).toHaveLength(0);
  });

  it('starts fresh after the hand leaves the frame', () => {
    const away = [...clock(1500, { start: 4300 })].map((t) => frame(t));
    const r = run([...beating({ bpm: 100, beats: 7 }), ...away, ...beating({ bpm: 100, beats: 7, start: 6000, at: { x: 0.3 } })]);
    const beats = r.of('beat').map((b) => b.t);
    // The hand comes back somewhere else: no phantom stroke from the jump; the next beat is a real one.
    expect(beats.filter((t) => t > 4300 && t < 6550)).toHaveLength(0);
    expect(beats.filter((t) => t >= 6550).length).toBeGreaterThanOrEqual(5);
  });
});

describe('conductor dynamics', () => {
  const level = (amp: number, size = 0.12) => run(beating({ bpm: 90, beats: 10, amp: amp * (size / 0.12), size })).of('dynamics');

  it('reads small beats as soft and big ones as loud', () => {
    expect(level(0.1).pop()?.level).toMatch(/^(pp|p)$/);
    expect(level(0.36).pop()?.level).toMatch(/^(f|ff)$/);
  });

  it('only speaks when the level changes', () => {
    expect(level(0.25)).toHaveLength(1);
    const swell = run([...beating({ bpm: 90, beats: 8, amp: 0.1 }), ...beating({ bpm: 90, beats: 8, amp: 0.36, start: 5333 })]).of('dynamics');
    expect(swell.map((d) => d.level)[0]).toMatch(/^(pp|p)$/);
    expect(swell[swell.length - 1]?.level).toMatch(/^(f|ff)$/);
    expect(swell.length).toBeLessThanOrEqual(4);
  });

  it('reads the same gesture the same from twice as far away', () => {
    const near = level(0.3, 0.12).pop()?.level;
    const far = level(0.3, 0.06).pop()?.level;
    expect(far).toBe(near);
  });
});

describe('conductor cut-off', () => {
  it('ends the piece on a fist held still for 400 ms, once', () => {
    const r = run([...beating({ bpm: 100, beats: 6 }), ...holding(POSES.fist, 900, { start: 3700, y: 0.55, x: 0.6 })]);
    const cut = r.of('cutoff');
    expect(cut).toHaveLength(1);
    expect(cut[0]?.t).toBeGreaterThanOrEqual(3700 + 400);
    expect(cut[0]?.t).toBeLessThan(3700 + 520);
  });

  it('does not cut off again while the fist stays closed, but does after it opens', () => {
    const once = run(holding(POSES.fist, 2000));
    expect(once.of('cutoff')).toHaveLength(1);
    const twice = run([...holding(POSES.fist, 600), ...holding(POSES.open, 300, { start: 633 }), ...holding(POSES.fist, 600, { start: 966 })]);
    expect(twice.of('cutoff')).toHaveLength(2);
  });

  it('needs the full 400 ms', () => {
    expect(run(holding(POSES.fist, 330)).of('cutoff')).toHaveLength(0);
  });

  it('survives a dropped frame mid-hold', () => {
    const frames = [...holding(POSES.fist, 600)].map((f, i) => (i === 6 ? frame(f.t) : f));
    expect(run(frames).of('cutoff')).toHaveLength(1);
  });

  it('is not fooled by a fist that keeps beating, or a hand that hangs loose', () => {
    expect(run(beating({ bpm: 100, beats: 8, pose: POSES.fist })).of('cutoff')).toHaveLength(0);
    expect(run(holding(POSES.relaxed, 1500)).of('cutoff')).toHaveLength(0);
  });

  it('works from the free hand while the baton hand beats', () => {
    const fist = (t: number) => (t > 2000 ? [makeHand(POSES.fist, { x: 0.25, y: 0.5, handedness: 'left' })] : []);
    expect(run(beating({ bpm: 100, beats: 6, others: fist })).of('cutoff')).toHaveLength(1);
  });
});

describe('conductor cues', () => {
  // A left hand pointing sideways with its fingertip in the given third
  const pointer = (tipX: number, handedness: 'left' | 'right' = 'left') => {
    const probe = makeHand(POSES.point, { rotate: -90, handedness });
    const dx = probe.indexTip.x - probe.palmCenter.x;
    return { pose: POSES.point, at: { x: tipX - dx, y: 0.45, rotate: -90, handedness } };
  };

  it('cues the section the free hand points at, after 500 ms', () => {
    for (const [x, side] of [
      [0.15, 'left'],
      [0.5, 'center'],
      [0.85, 'right'],
    ] as const) {
      const p = pointer(x);
      const point = (t: number) => (t > 1500 ? [makeHand(p.pose, { ...p.at, noise: 0.002 })] : []);
      const cues = run(beating({ bpm: 100, beats: 6, others: point, at: { x: 0.75 } })).of('cue');
      expect(cues).toHaveLength(1);
      expect(cues[0]?.side).toBe(side);
      expect(cues[0]?.t).toBeGreaterThanOrEqual(1500 + 500);
    }
  });

  it('cues from a lone hand too, but not from a quick point', () => {
    const p = pointer(0.85, 'right');
    expect(run(holding(p.pose, 800, p.at)).of('cue').map((c) => c.side)).toEqual(['right']);
    expect(run(holding(p.pose, 400, p.at)).of('cue')).toHaveLength(0);
  });

  it('does not flip sections when the finger rests on a boundary', () => {
    const random = rng(11);
    const frames = [...clock(2000)].map((t) => {
      const p = pointer(1 / 3 + 0.03 * Math.sin(t / 60));
      return frame(t, makeHand(p.pose, { ...p.at, noise: 0.002, random }));
    });
    expect(run(frames).of('cue').length).toBeLessThanOrEqual(1);
  });

  it('ignores a baton held like a pointer while it beats', () => {
    expect(run(beating({ bpm: 100, beats: 8, pose: POSES.point })).of('cue')).toHaveLength(0);
  });

  it('keeps sections steady with a dead band', () => {
    expect(sideFor(0.35, 'left')).toBe('left');
    expect(sideFor(0.4, 'left')).toBe('center');
    expect(sideFor(0.31, 'center')).toBe('center');
    expect(sideFor(0.2, null)).toBe('left');
    expect(sideFor(0.7, 'center')).toBe('center');
    expect(sideFor(0.9, 'center')).toBe('right');
  });
});

describe('HoldGate', () => {
  it('fires once per hold and re-arms after release', () => {
    const g = new HoldGate(400, 100);
    const fired = [...clock(1400)].map((t) => g.update(t, t < 600 || t > 800)).filter(Boolean);
    expect(fired).toHaveLength(2);
  });
});

// ---------- air play ----------

const air = (poses: readonly (Pose | null)[], at: Placement = {}) => {
  const cues: AirCue[] = [];
  const a = createAirPlay((c) => cues.push(c));
  poses.forEach((p, i) => a.push(frame(i * 33, ...(p ? [makeHand(p, at)] : []))));
  return cues;
};

const repeat = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
const FIST = fingersPose(false, [false, false, false, false]);
const INDEX = fingersPose(false, [true, false, false, false]);
const MIDDLE = fingersPose(false, [false, true, false, false]);
const RING = fingersPose(false, [false, false, true, false]);

describe('air play', () => {
  it('plays one note per finger lift', () => {
    const cues = air([...repeat(FIST, 5), ...repeat(INDEX, 6), ...repeat(FIST, 6), ...repeat(MIDDLE, 6), ...repeat(FIST, 4), ...repeat(RING, 5)]);
    expect(cues.map((c) => (c.kind === 'note' ? c.finger : c.kind))).toEqual([1, 2, 3]);
  });

  it('waits for 3 frames, so flicker never plays', () => {
    expect(air([...repeat(FIST, 4), INDEX, FIST, INDEX, INDEX, FIST, INDEX, FIST, FIST])).toHaveLength(0);
    expect(air([...repeat(FIST, 4), INDEX, INDEX])).toHaveLength(0);
    expect(air([...repeat(FIST, 4), INDEX, INDEX, INDEX])).toHaveLength(1);
  });

  it('counts a lift that wobbles on the way up as one note', () => {
    const cues = air([...repeat(FIST, 4), INDEX, INDEX, INDEX, FIST, INDEX, INDEX, FIST, FIST, INDEX, ...repeat(INDEX, 5)]);
    expect(cues).toHaveLength(1);
  });

  it('plays nothing for a hand that arrives with fingers up', () => {
    expect(air([null, null, ...repeat(POSES.open, 10)])).toHaveLength(0);
  });

  it('holds on a pinch and releases when it opens, without a stray note', () => {
    const cues = air([...repeat(POSES.open, 5), ...repeat(POSES.pinch, 10), ...repeat(POSES.open, 10)]);
    expect(cues.map((c) => c.kind)).toEqual(['hold', 'release']);
  });

  it('ignores a pinch that only touches for a frame or two', () => {
    expect(air([...repeat(POSES.open, 5), POSES.pinch, POSES.pinch, ...repeat(POSES.open, 6)])).toHaveLength(0);
  });

  it('still plays the other fingers during a pinch', () => {
    const pinchRingDown: Pose = { ...POSES.pinch, fingers: [POSES.pinch.fingers[0], POSES.pinch.fingers[1], [80, 100, 60], POSES.pinch.fingers[3]] };
    const cues = air([...repeat(POSES.open, 4), ...repeat(POSES.pinch, 5), ...repeat(pinchRingDown, 5), ...repeat(POSES.pinch, 5)]);
    expect(cues.map((c) => (c.kind === 'note' ? `note${c.finger}` : c.kind))).toEqual(['hold', 'note3']);
  });

  it('releases a held note if the hand leaves mid-pinch', () => {
    const cues = air([...repeat(POSES.open, 4), ...repeat(POSES.pinch, 6), null, null, null, null]);
    expect(cues.map((c) => c.kind)).toEqual(['hold', 'release']);
  });

  it('shrugs off landmark noise on a held pose', () => {
    const random = rng(5);
    const cues: AirCue[] = [];
    const a = createAirPlay((c) => cues.push(c));
    for (const t of clock(3000)) a.push(frame(t, makeHand(POSES.relaxed, { noise: 0.003, random })));
    for (const t of clock(3000, { start: 3033 })) a.push(frame(t, makeHand(FIST, { noise: 0.003, random })));
    expect(cues).toHaveLength(0);
  });
});
