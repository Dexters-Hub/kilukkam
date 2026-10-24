import { BatonTracker, dynamicsFor, steadyTempo, type BatonSample, type Dynamics } from '../baton.js';
import type { HandFrame, Handedness, Point, TrackedHand } from './features.js';
import { OneEuroFilter } from './filter.js';

/*
 * The camera conductor: hand frames in, musical cues out. It controls the
 * live room and can never end it: only the Stop button does that.
 *
 * Gesture vocabulary (the owner-approved set; every one but the beat has a
 * hold or confirm gate and a fill-up ring on the stage)
 *
 *   1 Tempo      Beat time with the baton hand. The bottom of each downstroke
 *                (the ictus) is a beat; the room tempo is the median of
 *                recent beat gaps, once they are steady.
 *   2 Dynamics   The off-hand flat (palm up or down, fingers sideways),
 *                lifted 1.2 hand sizes: one step louder; pressed down the
 *                same: one step softer (pp p mf f ff). The size of the beat
 *                still nudges the level when the palm has been quiet 8 s.
 *   3 Section in Point (index only) into the left, centre or right third of
 *                the picture and hold it there 1 s.
 *   4 Rest       One stop hand (open palm, fingers up, facing the camera)
 *                held still in a third for 1 s. That section rests.
 *   5 Pause      Both stop hands, held still 0.8 s. The room stops on the
 *                beat it reached.
 *   6 Resume     While paused, one big downbeat. The room counts in and
 *                plays on from where it stopped.
 *   7 Build      Both palms up (flat hands) rising slowly together: 1.5 hand
 *                sizes over at least 0.9 s, still rising when it lands.
 *   8 Drop       Both hands sweep down fast (2.5 hand sizes inside 450 ms)
 *                and stay down 300 ms.
 *   9 Loop bar   Draw a circle with the index finger: 300 degrees round
 *                inside 1.2 s, on a circle at least 0.35 hand sizes across.
 *                The same again ends the loop.
 *  10 Kilukkam!  Shake a hand side to side like ringing a bell: 3 direction
 *                reversals inside 0.8 s, each swing 0.4 to 2.5 hand sizes.
 *
 * Disambiguation
 *
 *   One stop hand in a third rests that section; two stop hands pause the
 *   room. Two flat hands rising are a build; one flat off-hand rising is a
 *   crescendo. A pointing finger held still cues a section; one moving
 *   round a circle loops the bar. A wave hello swings wider than 2.5 hand
 *   sizes, so it is not a bell shake; a trembling or scratching hand swings
 *   less than 0.4, so it is neither.
 *
 * Accidents
 *
 *   No gesture but the beat counts in the first 3 s after the camera starts,
 *   or from a hand in view for under 500 ms. Held shapes (point, rest,
 *   pause) need the hand still, under 2 hand sizes per second; a beat
 *   pattern moves at 6 to 15. A hold survives a dropout of up to 120 ms
 *   (three or four frames at 30 fps). Build, drop and loop rest 1.5 s after
 *   firing and Kilukkam 3 s. Every gesture but the beat restarts the beat
 *   tracking, so a drop's sweep or the resume downbeat is never timed as a
 *   tempo. There is no fist gesture: a closed or relaxed hand does nothing.
 *
 * Hands
 *
 *   The baton hand is the dominant hand (right unless told otherwise). With
 *   one hand in view, that hand does everything; MediaPipe's left or right
 *   label flickers on a lone hand, so it is ignored then. With two hands,
 *   the baton hand is the one labelled dominant, and when the labels are
 *   ambiguous, the one nearest to where the baton just was. Cues and
 *   dynamics come from the free hand when there is one, as a conductor's
 *   left hand shapes the sound while the right keeps time.
 *
 * Measuring
 *
 *   Distance. Every threshold is in hand sizes, and the palm height fed to
 *   the BatonTracker is scaled to a reference hand of 0.12 frame heights
 *   (about one metre from a laptop camera), so a gesture reads the same at
 *   any distance. One camera cannot see which way a palm faces, so palm up
 *   and palm down are told apart by the way the flat hand travels.
 *
 *   Jitter. Palm height goes through a One Euro filter: still hands are
 *   smoothed hard, fast strokes barely at all (see filter.ts).
 *
 *   Timing. The BatonTracker finds each beat at the lowest camera frame;
 *   the conductor then places the ictus between frames (see refineIctus)
 *   and takes the tempo from the median of the last 4 refined gaps, all
 *   within a quarter of that median. Re-evaluated on every beat but emitted
 *   at most once per bar (4 beats), and only when steadyTempo moves (3 bpm
 *   or more). A cue's third has a dead band of 0.04 frame widths at each
 *   boundary, so a hand resting on a line does not flip between sections.
 *
 *   Lost hand. If the baton hand is gone for 500 ms, or jumps more than a
 *   quarter of the frame in one frame (another hand took over), the tracker
 *   starts fresh instead of inventing a giant stroke.
 */

export type CueSide = 'left' | 'center' | 'right';

export type ConductorCue =
  | { kind: 'beat'; t: number; bpm: number | null; size: number }
  | { kind: 'tempo'; t: number; bpm: number }
  | { kind: 'dynamics'; t: number; level: Dynamics }
  | { kind: 'cue'; t: number; side: CueSide }
  | { kind: 'rest'; t: number; side: CueSide }
  | { kind: 'pause'; t: number }
  | { kind: 'resume'; t: number }
  | { kind: 'build'; t: number }
  | { kind: 'drop'; t: number }
  | { kind: 'loop'; t: number }
  | { kind: 'kilukkam'; t: number };

/** A gesture on its way to firing, for the fill-up rings on the camera picture */
export interface Hold {
  kind: 'cue' | 'rest' | 'pause' | 'crescendo' | 'diminuendo' | 'build' | 'drop' | 'loop' | 'kilukkam';
  /** 0 to 1; the gesture fires at 1 */
  progress: number;
  /** Where to draw the ring, in frame coordinates */
  at: Point;
  side?: CueSide;
}

export interface ConductorOptions {
  /** The hand that beats time */
  dominant?: Handedness;
  beatsPerBar?: number;
  /** The piece's written tempo, so the first measured tempo is compared with it */
  tempo?: number;
  /** Measure the beat pattern in hand sizes instead of frame heights */
  normaliseDistance?: boolean;
  /** Ignore every gesture but the beat for this long after the first frame (the camera starting) */
  armMs?: number;
}

export interface Conductor {
  push(frame: HandFrame): void;
  reset(): void;
  /** Whether the room is paused; set it from the room so a button press counts too */
  paused: boolean;
  readonly tempo: number | null;
  /** The room's dynamics; set it from the room so a palm step starts from the level everyone hears */
  dynamics: Dynamics | null;
  /** Gestures being held or drawn right now */
  readonly holds: readonly Hold[];
}

export const CONDUCTOR = {
  referenceHandSize: 0.12,
  stillSpeed: 2,
  /** No gesture but the beat for this long after the camera starts */
  armMs: 3000,
  /** A hand must be in view this long before its gestures count */
  settleMs: 500,
  cueHoldMs: 1000,
  restHoldMs: 1000,
  pauseHoldMs: 800,
  /** A downbeat this big (BatonTracker size, 0 to 1) resumes a paused room */
  resumeBeatSize: 0.55,
  /** Stop hand: fingertips at least this many hand sizes above the wrist */
  palmUp: 0.6,
  /** Flat hand: fingers this much more sideways than up or down */
  flat: 1.2,
  /** A dynamics step: the flat off-hand travels this far (hand sizes) up or down... */
  dynTravel: 1.2,
  /** ...inside this long, no faster than a placing hand */
  dynMaxMs: 1500,
  dynMaxSpeed: 6,
  dynCooldownMs: 700,
  /** After a palm step, the beat size leaves the dynamics alone this long */
  palmLeadMs: 8000,
  buildRise: 1.5,
  buildMinMs: 900,
  /** Faster than this (hand sizes per second) is a fling, not a build */
  buildMaxSpeed: 5,
  /** Both hands must still be rising this fast (hand sizes per second) when the build fires */
  buildMinRise: 0.4,
  /** A rising hand may dip this far (hand sizes) without restarting the build */
  buildSlack: 0.5,
  dropFall: 2.5,
  dropWindowMs: 450,
  dropHoldMs: 300,
  /** After a sweep, the hands must settle within this long */
  dropSettleMs: 700,
  /** The loop: the fingertip turns this far round (radians) inside the window, on a circle at least this big */
  loopTurn: (300 * Math.PI) / 180,
  loopWindowMs: 1200,
  loopMinRadius: 0.35,
  /** Kilukkam: direction reversals of a side to side shake inside the window */
  shakeReversals: 3,
  shakeWindowMs: 800,
  /** Each swing, peak to peak in hand sizes: bigger than a tremble, smaller than a wave hello */
  shakeMinSwing: 0.4,
  shakeMaxSwing: 2.5,
  kilukkamCooldownMs: 3000,
  /** Build, drop and loop rest this long after one fires */
  cooldownMs: 1500,
  holdGraceMs: 120,
  cueDeadBand: 0.04,
  lostMs: 500,
  jump: 0.25,
  sizeWindow: 15,
  tempoWindow: 5,
  dynamicsWindow: 3,
} as const;

const LEVELS: readonly Dynamics[] = ['pp', 'p', 'mf', 'f', 'ff'];

/** One dynamics step up (+1) or down (-1), staying inside pp..ff */
export const stepDynamics = (from: Dynamics | null, by: 1 | -1): Dynamics => {
  const i = LEVELS.indexOf(from ?? 'mf');
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + by))] ?? 'mf';
};

/** True once a condition has held for `ms`, tolerating brief dropouts; re-arms when it ends. */
export class HoldGate {
  private since: number | null = null;
  private lastOn = -Infinity;
  private key = '';
  private fired = false;

  constructor(
    private readonly ms: number,
    private readonly graceMs: number,
  ) {}

  /** `key` names what is held; a different key starts a new hold. */
  update(t: number, on: boolean, key = ''): boolean {
    if (!on) {
      if (t - this.lastOn > this.graceMs) {
        this.since = null;
        this.fired = false;
      }
      return false;
    }
    if (this.since === null || key !== this.key || t - this.lastOn > this.graceMs) {
      this.since = t;
      this.key = key;
      this.fired = false;
    }
    this.lastOn = t;
    if (!this.fired && t - this.since >= this.ms) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** How far along the current hold is, 0 to 1; 0 when nothing is held or it already fired */
  progress(t: number): number {
    if (this.since === null || this.fired || t - this.lastOn > this.graceMs) return 0;
    return Math.min(1, (t - this.since) / this.ms);
  }

  reset(): void {
    this.since = null;
    this.lastOn = -Infinity;
    this.fired = false;
  }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/**
 * Where between frames the ictus really fell. The BatonTracker reports the
 * lowest sample, which at 30 fps can be 16 ms off, and at 15 fps 33 ms: up
 * to 10 bpm of error at a brisk tempo. The bottom of a beat is a bounce, a
 * V rather than a curve, so the V through the low sample and its two
 * neighbours (equal slopes either side) places it to a millisecond or two.
 */
export const refineIctus = (samples: readonly BatonSample[], at: number): number => {
  const [a, b, c] = samples;
  if (!a || !b || !c || b.t !== at || b.y < a.y || b.y < c.y) return at;
  const h = (c.t - a.t) / 2;
  const fall = b.y - Math.min(a.y, c.y);
  if (h <= 0 || fall <= 0) return at;
  const offset = ((c.y - a.y) / (2 * fall)) * h;
  return b.t + Math.max(-h / 2, Math.min(h / 2, offset));
};

const isoDist = (a: Point, b: Point, aspect: number): number => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Index up, the other three fingers down. The thumb is free. */
export const isPointing = (h: TrackedHand): boolean =>
  h.fingersUp[1] && !h.fingersUp[2] && !h.fingersUp[3] && !h.fingersUp[4];

/** The "stop" hand: an open palm with the fingers pointing up, as a palm faces the camera. */
export const isStopHand = (h: TrackedHand): boolean => h.openPalm && h.wrist.y - h.indexTip.y >= CONDUCTOR.palmUp * h.size;

/**
 * A flat hand: the four fingers out and pointing sideways, as a palm held
 * up to the ceiling or down to the floor looks to a camera in front of you.
 * One camera cannot tell up from down; the way the hand travels can.
 */
export const isFlatHand = (h: TrackedHand, aspect = 4 / 3): boolean =>
  h.fingersUp[1] && h.fingersUp[2] && h.fingersUp[3] && h.fingersUp[4] && Math.abs(h.indexTip.x - h.wrist.x) * aspect > CONDUCTOR.flat * Math.abs(h.indexTip.y - h.wrist.y);

/** Which third of the frame x falls in, keeping `prev` inside the dead band around each boundary. */
export const sideFor = (x: number, prev: CueSide | null, band: number = CONDUCTOR.cueDeadBand): CueSide => {
  const raw: CueSide = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
  if (!prev || prev === raw) return raw;
  const edge = prev === 'left' ? 1 / 3 : prev === 'right' ? 2 / 3 : raw === 'left' ? 1 / 3 : 2 / 3;
  return Math.abs(x - edge) < band ? prev : raw;
};

/** Total turn (radians, signed) of a path around its own centre, and its mean radius. */
export const turnOf = (pts: readonly Point[]): { turn: number; radius: number } => {
  if (pts.length < 3) return { turn: 0, radius: 0 };
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let turn = 0;
  let prev = Math.atan2((pts[0]?.y ?? 0) - cy, (pts[0]?.x ?? 0) - cx);
  for (const p of pts.slice(1)) {
    const a = Math.atan2(p.y - cy, p.x - cx);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turn += d;
    prev = a;
  }
  const radius = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
  return { turn, radius };
};

/**
 * Side to side reversals in a run of x positions (hand sizes): a reversal
 * counts once the hand has come back `minSwing` from its last extreme. Any
 * swing wider than `maxSwing` is a wave, not a shake, and spoils the run.
 */
export const shakeOf = (xs: readonly number[], minSwing: number = CONDUCTOR.shakeMinSwing, maxSwing: number = CONDUCTOR.shakeMaxSwing): number => {
  const first = xs[0] ?? 0;
  let reversals = 0;
  let dir = 0;
  let extreme = first;
  let lastTurn = first;
  for (const x of xs.slice(1)) {
    if (dir === 0) {
      if (Math.abs(x - first) >= minSwing) {
        dir = Math.sign(x - first);
        extreme = x;
      }
      continue;
    }
    if (dir > 0 ? x > extreme : x < extreme) {
      extreme = x;
      continue;
    }
    if (Math.abs(x - extreme) < minSwing) continue;
    if (Math.abs(extreme - lastTurn) > maxSwing) return 0;
    reversals++;
    lastTurn = extreme;
    dir = -dir;
    extreme = x;
  }
  return reversals;
};

/** One hand role (baton or free): speed in hand sizes per second, how long it has been in view, and its recent path. */
class Motion {
  private last: { t: number; p: Point } | null = null;
  private seen = -Infinity;
  speed = Infinity;
  /** Vertical speed, hand sizes per second, positive = rising */
  rise = 0;
  /** When this hand came into view */
  since = 0;
  /** Recent palm heights in hand sizes, for the drop */
  trail: { t: number; y: number }[] = [];
  /** Recent palm x in hand sizes, for the shake */
  sway: { t: number; x: number }[] = [];

  update(t: number, h: TrackedHand | undefined, aspect: number): void {
    // A dropped frame keeps the hand; only a longer absence makes the next sighting a new arrival.
    if (!h) return;
    if (t - this.seen > CONDUCTOR.lostMs) {
      this.last = null;
      this.speed = Infinity;
      this.rise = 0;
      this.since = t;
      this.trail = [];
      this.sway = [];
    }
    this.seen = t;
    const prev = this.last;
    this.last = { t, p: h.palmCenter };
    this.trail.push({ t, y: h.palmCenter.y / h.size });
    while ((this.trail[0]?.t ?? t) < t - CONDUCTOR.dropWindowMs) this.trail.shift();
    this.sway.push({ t, x: (h.palmCenter.x * aspect) / h.size });
    while ((this.sway[0]?.t ?? t) < t - CONDUCTOR.shakeWindowMs) this.sway.shift();
    if (!prev || t <= prev.t) return;
    const dt = (t - prev.t) / 1000;
    const v = isoDist(h.palmCenter, prev.p, aspect) / h.size / dt;
    const up = (prev.p.y - h.palmCenter.y) / h.size / dt;
    this.speed = Number.isFinite(this.speed) ? this.speed * 0.5 + v * 0.5 : v;
    this.rise = this.rise * 0.5 + up * 0.5;
  }

  get still(): boolean {
    return this.speed < CONDUCTOR.stillSpeed;
  }

  settled(t: number): boolean {
    return t - this.seen <= CONDUCTOR.holdGraceMs && t - this.since >= CONDUCTOR.settleMs;
  }

  /** How far the palm fell (hand sizes) inside the drop window */
  get fell(): number {
    const now = this.trail[this.trail.length - 1];
    if (!now) return 0;
    return now.y - Math.min(...this.trail.map((s) => s.y));
  }
}

export function createConductor(emit: (cue: ConductorCue) => void, opts: ConductorOptions = {}): Conductor {
  const dominant = opts.dominant ?? 'right';
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const normalise = opts.normaliseDistance ?? true;
  const armMs = opts.armMs ?? CONDUCTOR.armMs;

  const baton = new BatonTracker();
  const smooth = new OneEuroFilter();
  const pauseHold = new HoldGate(CONDUCTOR.pauseHoldMs, CONDUCTOR.holdGraceMs);
  const cueHold = new HoldGate(CONDUCTOR.cueHoldMs, CONDUCTOR.holdGraceMs);
  const restHold = new HoldGate(CONDUCTOR.restHoldMs, CONDUCTOR.holdGraceMs);
  const batonMotion = new Motion();
  const freeMotion = new Motion();

  let tempo: number | null = opts.tempo ?? null;
  let dynamics: Dynamics | null = null;
  let beatsSinceTempo = 0;
  let sizes: number[] = [];
  let beatSizes: number[] = [];
  let lastBaton: { t: number; p: Point } | null = null;
  let lastY = 0;
  let virtualY = 0;
  /** The last three baton samples, to place the ictus between frames */
  let recent: BatonSample[] = [];
  /** Refined beat times, for the tempo */
  let ictus: number[] = [];
  let cueSide: CueSide | null = null;
  let lastPointT = -Infinity;
  let restSide: CueSide | null = null;
  let firstT: number | null = null;
  let paused = false;
  let palmUntil = -Infinity;
  let dyn: { t: number; y: number; dir: 0 | 1 | -1 } | null = null;
  let dynUntil = -Infinity;
  let build: { t: number; y: [number, number]; best: [number, number] } | null = null;
  let sweep: { t: number; still: number | null } | null = null;
  let circle: { t: number; p: Point }[] = [];
  let cooldownUntil = -Infinity;
  let kilukkamUntil = -Infinity;
  let holds: Hold[] = [];

  const restartStroke = (): void => {
    baton.reset();
    smooth.reset();
    sizes = [];
    virtualY = 0;
    recent = [];
    ictus = [];
  };

  // Any gesture but the beat itself breaks the beat pattern: the strokes it
  // made (a drop's sweep, the resume downbeat) are not beats to time from.
  const onCue = (cue: ConductorCue): void => {
    if (cue.kind !== 'beat' && cue.kind !== 'tempo' && cue.kind !== 'dynamics') restartStroke();
    emit(cue);
  };

  const pick = (hands: readonly TrackedHand[]): { batonHand?: TrackedHand; free?: TrackedHand } => {
    const [a, b] = hands;
    if (!a) return {};
    if (!b) return { batonHand: a };
    const nearer = (): [TrackedHand, TrackedHand] => {
      if (!lastBaton) return [a, b];
      const p = lastBaton.p;
      return Math.hypot(a.palmCenter.x - p.x, a.palmCenter.y - p.y) <= Math.hypot(b.palmCenter.x - p.x, b.palmCenter.y - p.y) ? [a, b] : [b, a];
    };
    const aDom = a.handedness === dominant;
    const bDom = b.handedness === dominant;
    const [batonHand, free] = aDom !== bDom ? (aDom ? [a, b] : [b, a]) : nearer();
    return { batonHand, free };
  };

  const setPaused = (on: boolean): void => {
    if (on === paused) return;
    paused = on;
    pauseHold.reset();
    restHold.reset();
    cueHold.reset();
    build = null;
    sweep = null;
    dyn = null;
    circle = [];
  };

  const feedBaton = (t: number, h: TrackedHand, aspect: number): void => {
    const jumped = lastBaton !== null && isoDist(h.palmCenter, lastBaton.p, aspect) > CONDUCTOR.jump;
    const lost = lastBaton === null || t - lastBaton.t > CONDUCTOR.lostMs;
    if (jumped || lost) restartStroke();
    lastBaton = { t, p: h.palmCenter };

    sizes.push(h.size);
    if (sizes.length > CONDUCTOR.sizeWindow) sizes.shift();
    const scale = normalise ? CONDUCTOR.referenceHandSize / Math.max(0.02, median(sizes)) : 1;

    const y = smooth.filter(h.palmCenter.y, t);
    if (jumped || lost) lastY = y;
    virtualY += (y - lastY) * scale;
    lastY = y;

    const sample = { t, y: virtualY };
    recent.push(sample);
    if (recent.length > 3) recent.shift();
    const beat = baton.push(sample);
    if (!beat) return;
    const at = refineIctus(recent, beat.t);
    ictus.push(at);
    if (ictus.length > CONDUCTOR.tempoWindow) ictus.shift();
    const gaps = ictus.slice(1).map((b, i) => b - (ictus[i] ?? b));
    const bpm = gaps.length >= 2 ? Math.round(60_000 / median(gaps)) : null;
    onCue({ kind: 'beat', t: at, bpm, size: beat.size });
    // Paused: one big downbeat brings the room back in.
    if (paused) {
      if (beat.size >= CONDUCTOR.resumeBeatSize) {
        setPaused(false);
        onCue({ kind: 'resume', t });
      }
      return;
    }

    beatSizes.push(beat.size);
    if (beatSizes.length > CONDUCTOR.dynamicsWindow) beatSizes.shift();
    const level = dynamicsFor(median(beatSizes));
    // The off-hand palm leads the dynamics; the beat size only nudges them when the palm is quiet.
    if (level !== dynamics && t >= palmUntil) {
      dynamics = level;
      onCue({ kind: 'dynamics', t: at, level });
    }

    beatsSinceTempo++;
    // Only a steady beat sets the tempo: every recent gap within a quarter of their median.
    const steady = gaps.length >= 2 && gaps.every((g) => Math.abs(g - median(gaps)) <= 0.25 * median(gaps));
    if (bpm === null || !steady) return;
    if (tempo === null) {
      tempo = steadyTempo(-Infinity, bpm);
      beatsSinceTempo = 0;
      onCue({ kind: 'tempo', t: at, bpm: tempo });
    } else if (beatsSinceTempo >= beatsPerBar) {
      const next = steadyTempo(tempo, bpm);
      if (next !== tempo) {
        tempo = next;
        beatsSinceTempo = 0;
        onCue({ kind: 'tempo', t: at, bpm: next });
      }
    }
  };

  type Role = [TrackedHand | undefined, Motion];

  /** Pause: both stop hands, still, held. */
  const pauseGesture = (t: number, a: Role, b: Role): boolean => {
    // Held, not travelling: a slow two-hand build passes through "still" but keeps rising.
    const palms = [a, b].every(([h, m]) => h && isStopHand(h) && m.still && Math.abs(m.rise) < CONDUCTOR.buildMinRise && m.settled(t));
    if (pauseHold.update(t, palms)) {
      setPaused(true);
      onCue({ kind: 'pause', t });
      return true;
    }
    if (palms && a[0] && b[0]) {
      const at = { x: (a[0].palmCenter.x + b[0].palmCenter.x) / 2, y: (a[0].palmCenter.y + b[0].palmCenter.y) / 2 };
      holds.push({ kind: 'pause', progress: pauseHold.progress(t), at });
    }
    return false;
  };

  /** Crescendo and diminuendo: the flat off-hand lifted or pressed down, one step per gesture. */
  const dynamicsGesture = (t: number, aspect: number, batonHand: TrackedHand, free: TrackedHand): boolean => {
    const building = isFlatHand(batonHand, aspect) && batonMotion.rise > CONDUCTOR.buildMinRise;
    if (t < dynUntil || building || !isFlatHand(free, aspect) || !freeMotion.settled(t) || freeMotion.speed > CONDUCTOR.dynMaxSpeed) {
      dyn = null;
      return false;
    }
    const y = free.palmCenter.y / free.size;
    if (!dyn || t - dyn.t > CONDUCTOR.dynMaxMs) dyn = { t, y, dir: 0 };
    const travel = dyn.y - y; // positive = lifted
    const dir = travel > 0.3 ? 1 : travel < -0.3 ? -1 : 0;
    if (dyn.dir !== 0 && dir !== 0 && dir !== dyn.dir) dyn = { t, y, dir: 0 };
    else if (dir !== 0) dyn.dir = dir;
    const progress = Math.min(1, Math.abs(travel) / CONDUCTOR.dynTravel);
    if (progress >= 1 && dir !== 0) {
      dynamics = stepDynamics(dynamics, dir);
      palmUntil = t + CONDUCTOR.palmLeadMs;
      dynUntil = t + CONDUCTOR.dynCooldownMs;
      dyn = null;
      onCue({ kind: 'dynamics', t, level: dynamics });
      return true;
    }
    if (dir !== 0) holds.push({ kind: dir > 0 ? 'crescendo' : 'diminuendo', progress, at: free.palmCenter });
    return false;
  };

  /** Build and drop: both hands at once. */
  const twoHands = (t: number, aspect: number, a: TrackedHand, b: TrackedHand): boolean => {
    if (t < cooldownUntil) {
      build = null;
      sweep = null;
      return false;
    }
    const fire = (kind: 'build' | 'drop'): true => {
      build = null;
      sweep = null;
      cooldownUntil = t + CONDUCTOR.cooldownMs;
      onCue({ kind, t });
      return true;
    };
    const mid = { x: (a.palmCenter.x + b.palmCenter.x) / 2, y: (a.palmCenter.y + b.palmCenter.y) / 2 };
    const settled = batonMotion.settled(t) && freeMotion.settled(t);

    // Build: both palms up (flat hands) rising slowly, together.
    const ya: [number, number] = [a.palmCenter.y / a.size, b.palmCenter.y / b.size];
    const slow = Math.abs(batonMotion.rise) < CONDUCTOR.buildMaxSpeed && Math.abs(freeMotion.rise) < CONDUCTOR.buildMaxSpeed;
    if (isFlatHand(a, aspect) && isFlatHand(b, aspect) && slow && settled) {
      if (!build) build = { t, y: ya, best: ya };
      else {
        build.best = [Math.min(build.best[0], ya[0]), Math.min(build.best[1], ya[1])];
        if (ya[0] - build.best[0] > CONDUCTOR.buildSlack || ya[1] - build.best[1] > CONDUCTOR.buildSlack) build = { t, y: ya, best: ya };
      }
      const risen = Math.min(build.y[0] - ya[0], build.y[1] - ya[1]);
      const progress = Math.max(0, Math.min(1, risen / CONDUCTOR.buildRise, (t - build.t) / CONDUCTOR.buildMinMs));
      // Still rising as it lands: a beat that rose and now floats at the top is not a build.
      const rising = batonMotion.rise > CONDUCTOR.buildMinRise && freeMotion.rise > CONDUCTOR.buildMinRise;
      if (progress >= 1 && rising) return fire('build');
      if (risen > 0.3) holds.push({ kind: 'build', progress, at: mid });
    } else build = null;

    // Drop: both hands sweep down fast, then stay down.
    const swept = batonMotion.fell >= CONDUCTOR.dropFall && freeMotion.fell >= CONDUCTOR.dropFall;
    if (swept && settled && !sweep) sweep = { t, still: null };
    if (sweep) {
      const still = batonMotion.speed < CONDUCTOR.stillSpeed * 2 && freeMotion.speed < CONDUCTOR.stillSpeed * 2;
      const back = batonMotion.rise > CONDUCTOR.stillSpeed * 2 || freeMotion.rise > CONDUCTOR.stillSpeed * 2;
      if (back || (sweep.still === null && t - sweep.t > CONDUCTOR.dropSettleMs)) sweep = null;
      else if (!still) sweep.still = null;
      else {
        sweep.still ??= t;
        const progress = Math.min(1, (t - sweep.still) / CONDUCTOR.dropHoldMs);
        if (progress >= 1) return fire('drop');
        holds.push({ kind: 'drop', progress, at: mid });
      }
    }
    return false;
  };

  /** Loop: a circle drawn with the pointing fingertip. */
  const loopGesture = (t: number, aspect: number, h: TrackedHand | undefined, m: Motion): boolean => {
    if (!h || !isPointing(h) || !m.settled(t) || t < cooldownUntil) {
      circle = [];
      return false;
    }
    circle.push({ t, p: { x: (h.indexTip.x * aspect) / h.size, y: h.indexTip.y / h.size } });
    while ((circle[0]?.t ?? t) < t - CONDUCTOR.loopWindowMs) circle.shift();
    const { turn, radius } = turnOf(circle.map((c) => c.p));
    if (radius < CONDUCTOR.loopMinRadius) return false;
    const progress = Math.min(1, Math.abs(turn) / CONDUCTOR.loopTurn);
    if (progress >= 1) {
      circle = [];
      cooldownUntil = t + CONDUCTOR.cooldownMs;
      onCue({ kind: 'loop', t });
      return true;
    }
    if (progress > 0.25) holds.push({ kind: 'loop', progress, at: h.indexTip });
    return false;
  };

  /** Kilukkam: a quick side to side shake, like ringing a bell. */
  const kilukkamGesture = (t: number, roles: Role[]): boolean => {
    if (t < kilukkamUntil) return false;
    for (const [h, m] of roles) {
      if (!h || isPointing(h) || !m.settled(t)) continue;
      const reversals = shakeOf(m.sway.map((s) => s.x));
      if (reversals >= CONDUCTOR.shakeReversals) {
        m.sway = [];
        kilukkamUntil = t + CONDUCTOR.kilukkamCooldownMs;
        onCue({ kind: 'kilukkam', t });
        return true;
      }
      if (reversals > 0) holds.push({ kind: 'kilukkam', progress: reversals / CONDUCTOR.shakeReversals, at: h.palmCenter });
    }
    return false;
  };

  const endPiece = (): void => {
    restartStroke();
    cueHold.reset();
    restHold.reset();
    pauseHold.reset();
    beatSizes = [];
    beatsSinceTempo = 0;
    lastBaton = null;
    cueSide = null;
    restSide = null;
    build = null;
    sweep = null;
    dyn = null;
    circle = [];
  };

  const reset = (): void => {
    endPiece();
    firstT = null;
    paused = false;
  };

  return {
    push(frame) {
      const { t, aspect } = frame;
      firstT ??= t;
      holds = [];
      const { batonHand, free } = pick(frame.hands);
      batonMotion.update(t, batonHand, aspect);
      freeMotion.update(t, free, aspect);
      if (batonHand) feedBaton(t, batonHand, aspect);
      // The first seconds after the camera starts are for finding your place, not for gestures.
      if (paused || t - firstT < armMs) return;

      const roles: Role[] = [
        [batonHand, batonMotion],
        [free, freeMotion],
      ];
      if (batonHand && free) {
        if (pauseGesture(t, roles[0] as Role, roles[1] as Role)) return;
        if (twoHands(t, aspect, batonHand, free)) return;
        if (dynamicsGesture(t, aspect, batonHand, free)) return;
      }
      if (kilukkamGesture(t, roles)) return;

      // Section in: point and hold, still.
      const cueHand = free ?? batonHand;
      const cueMotion = free ? freeMotion : batonMotion;
      if (loopGesture(t, aspect, cueHand, cueMotion)) return;
      const pointing = !!cueHand && isPointing(cueHand) && cueMotion.still && cueMotion.settled(t);
      if (pointing) {
        cueSide = sideFor(cueHand.indexTip.x, cueSide);
        lastPointT = t;
      } else if (t - lastPointT > CONDUCTOR.holdGraceMs) {
        cueSide = null;
      }
      if (cueHold.update(t, pointing, cueSide ?? '') && cueSide) onCue({ kind: 'cue', t, side: cueSide });
      else if (pointing && cueSide) holds.push({ kind: 'cue', progress: cueHold.progress(t), at: cueHand.indexTip, side: cueSide });

      // Section rest: one stop hand in a third, still; two stop hands are the pause.
      const stops = roles.filter(([h, m]) => h && isStopHand(h) && m.still && m.settled(t));
      const otherOpen = roles.some(([h]) => h && h.openPalm && !stops.some(([s]) => s === h));
      const stop = stops.length === 1 && !otherOpen ? stops[0]?.[0] : undefined;
      restSide = stop ? sideFor(stop.palmCenter.x, restSide) : null;
      if (restHold.update(t, !!stop, restSide ?? '') && restSide) onCue({ kind: 'rest', t, side: restSide });
      else if (stop && restSide) holds.push({ kind: 'rest', progress: restHold.progress(t), at: stop.palmCenter, side: restSide });
    },
    reset,
    get paused() {
      return paused;
    },
    set paused(on: boolean) {
      setPaused(on);
    },
    get tempo() {
      return tempo;
    },
    get dynamics() {
      return dynamics;
    },
    set dynamics(level: Dynamics | null) {
      dynamics = level;
    },
    get holds() {
      return holds;
    },
  };
}
