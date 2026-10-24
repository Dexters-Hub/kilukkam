import { BatonTracker, dynamicsFor, steadyTempo, type BatonSample, type Dynamics } from '../baton.js';
import type { HandFrame, Handedness, Point, TrackedHand } from './features.js';
import { OneEuroFilter } from './filter.js';

/*
 * The camera conductor: hand frames in, musical cues out.
 *
 * Gesture vocabulary
 *
 *   Beat      Move the baton hand down and up. The bottom of each downstroke
 *             (the ictus) is a beat. Tempo is the median of recent beat gaps.
 *   Dynamics  The size of the beat pattern. Small and careful is pp, big and
 *             sweeping is ff, exactly as a section reads a real conductor.
 *   Cut-off   Close the hand into a fist and hold it still for 400 ms.
 *   Cue       Point the index finger (other fingers curled) into the left,
 *             centre or right third of the frame and hold it there for 500 ms.
 *
 * Hands
 *
 *   The baton hand is the dominant hand (right unless told otherwise). With
 *   one hand in view, that hand does everything; MediaPipe's left or right
 *   label flickers on a lone hand, so it is ignored then. With two hands,
 *   the baton hand is the one labelled dominant, and when the labels are
 *   ambiguous, the one nearest to where the baton just was. Cues come from
 *   the free hand when there is one, as a conductor's left hand cues while
 *   the right keeps time. Either hand can cut off.
 *
 * Thresholds and why
 *
 *   Distance. A conductor two metres from a laptop makes half the movement
 *   in the frame that they make at one metre. The palm height fed to the
 *   BatonTracker is therefore measured in hand sizes (scaled to a reference
 *   hand of 0.12 frame heights, about one metre from a laptop camera), so a
 *   forte gesture reads forte at any distance. The scale is applied to each
 *   frame's movement rather than to the position, so a change in the hand
 *   size estimate cannot itself look like a stroke.
 *
 *   Jitter. Palm height goes through a One Euro filter: still hands are
 *   smoothed hard, fast strokes barely at all (see filter.ts).
 *
 *   Stillness. A cut-off and a cue are held, deliberate shapes. Both require
 *   the hand to move under 2 hand sizes per second; a beat pattern moves at
 *   6 to 15. Without this, a relaxed hand that happens to curl mid-stroke
 *   would end the piece, and a conductor who beats with a pointing finger
 *   would cue on every bar.
 *
 *   Holds. 400 ms for the cut-off is long enough that closing the hand
 *   between beats is not a cut-off, short enough to land on the final
 *   note. 500 ms for a cue is about one beat at 120 bpm. A hold survives a
 *   dropout of up to 120 ms (three or four frames at 30 fps) so a single
 *   missed detection does not restart it. A cue's third has a dead band of
 *   0.04 frame widths at each boundary, so a hand resting on a line does
 *   not flip between sections.
 *
 *   Timing. The BatonTracker finds each beat at the lowest camera frame;
 *   the conductor then places the ictus between frames (see refineIctus)
 *   and takes the tempo from the median of the last 4 refined gaps. This
 *   keeps the tempo within 2 to 3 bpm at 30 fps and at 15 fps, where frame
 *   times alone are off by up to 10 bpm.
 *
 *   Tempo. Re-evaluated on every beat but emitted at most once per bar
 *   (4 beats), and only when steadyTempo moves (3 bpm or more), so the room
 *   follows real tempo changes without hearing every wobble.
 *
 *   Dynamics. The median size of the last 3 beats, emitted only when the
 *   level changes, so one big beat does not flash ff.
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
  | { kind: 'cutoff'; t: number }
  | { kind: 'cue'; t: number; side: CueSide };

export interface ConductorOptions {
  /** The hand that beats time */
  dominant?: Handedness;
  beatsPerBar?: number;
  /** The piece's written tempo, so the first measured tempo is compared with it */
  tempo?: number;
  /** Measure the beat pattern in hand sizes instead of frame heights */
  normaliseDistance?: boolean;
}

export interface Conductor {
  push(frame: HandFrame): void;
  reset(): void;
  readonly tempo: number | null;
  readonly dynamics: Dynamics | null;
}

export const CONDUCTOR = {
  referenceHandSize: 0.12,
  stillSpeed: 2,
  cutoffHoldMs: 400,
  cueHoldMs: 500,
  holdGraceMs: 120,
  cueDeadBand: 0.04,
  lostMs: 500,
  jump: 0.25,
  sizeWindow: 15,
  tempoWindow: 5,
  dynamicsWindow: 3,
} as const;

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

/** Which third of the frame x falls in, keeping `prev` inside the dead band around each boundary. */
export const sideFor = (x: number, prev: CueSide | null, band: number = CONDUCTOR.cueDeadBand): CueSide => {
  const raw: CueSide = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
  if (!prev || prev === raw) return raw;
  const edge = prev === 'left' ? 1 / 3 : prev === 'right' ? 2 / 3 : raw === 'left' ? 1 / 3 : 2 / 3;
  return Math.abs(x - edge) < band ? prev : raw;
};

/** Speed of one hand role (baton or free) in hand sizes per second, lightly smoothed. */
class Motion {
  private last: { t: number; p: Point } | null = null;
  speed = Infinity;

  update(t: number, h: TrackedHand | undefined, aspect: number): void {
    if (!h) {
      this.last = null;
      this.speed = Infinity;
      return;
    }
    const prev = this.last;
    this.last = { t, p: h.palmCenter };
    if (!prev || t <= prev.t) return;
    const v = isoDist(h.palmCenter, prev.p, aspect) / h.size / ((t - prev.t) / 1000);
    this.speed = Number.isFinite(this.speed) ? this.speed * 0.5 + v * 0.5 : v;
  }

  get still(): boolean {
    return this.speed < CONDUCTOR.stillSpeed;
  }
}

export function createConductor(onCue: (cue: ConductorCue) => void, opts: ConductorOptions = {}): Conductor {
  const dominant = opts.dominant ?? 'right';
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const normalise = opts.normaliseDistance ?? true;

  const baton = new BatonTracker();
  const smooth = new OneEuroFilter();
  const cutoffHold = new HoldGate(CONDUCTOR.cutoffHoldMs, CONDUCTOR.holdGraceMs);
  const cueHold = new HoldGate(CONDUCTOR.cueHoldMs, CONDUCTOR.holdGraceMs);
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

  const restartStroke = (): void => {
    baton.reset();
    smooth.reset();
    sizes = [];
    virtualY = 0;
    recent = [];
    ictus = [];
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

    beatSizes.push(beat.size);
    if (beatSizes.length > CONDUCTOR.dynamicsWindow) beatSizes.shift();
    const level = dynamicsFor(median(beatSizes));
    if (level !== dynamics) {
      dynamics = level;
      onCue({ kind: 'dynamics', t: at, level });
    }

    beatsSinceTempo++;
    if (bpm === null) return;
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

  const endPiece = (): void => {
    restartStroke();
    cueHold.reset();
    beatSizes = [];
    beatsSinceTempo = 0;
    lastBaton = null;
    cueSide = null;
  };

  const reset = (): void => {
    endPiece();
    cutoffHold.reset();
  };

  return {
    push(frame) {
      const { t, aspect } = frame;
      const { batonHand, free } = pick(frame.hands);
      batonMotion.update(t, batonHand, aspect);
      freeMotion.update(t, free, aspect);
      if (batonHand) feedBaton(t, batonHand, aspect);

      const fistStill = (h: TrackedHand | undefined, m: Motion) => !!h && h.fist && m.still;
      if (cutoffHold.update(t, fistStill(batonHand, batonMotion) || fistStill(free, freeMotion))) {
        onCue({ kind: 'cutoff', t });
        // The piece is over: start the next one fresh. The cut-off itself stays
        // spent until the fist opens, so holding it does not cut off again.
        endPiece();
        return;
      }

      const cueHand = free ?? batonHand;
      const cueMotion = free ? freeMotion : batonMotion;
      const pointing = !!cueHand && isPointing(cueHand) && cueMotion.still;
      if (pointing) {
        cueSide = sideFor(cueHand.indexTip.x, cueSide);
        lastPointT = t;
      } else if (t - lastPointT > CONDUCTOR.holdGraceMs) {
        cueSide = null;
      }
      if (cueHold.update(t, pointing, cueSide ?? '') && cueSide) onCue({ kind: 'cue', t, side: cueSide });
    },
    reset,
    get tempo() {
      return tempo;
    },
    get dynamics() {
      return dynamics;
    },
  };
}
