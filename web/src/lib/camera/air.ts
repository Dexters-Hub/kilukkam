import type { HandFrame, Handedness, TrackedHand } from './features.js';

// Air play: a hand in front of the camera becomes the play surface.
//
//   Lift a finger  one note (the caller plays the next note, as a tap would)
//   Pinch          a held note; opening the pinch releases it
//
// Every finger and the pinch is debounced: a change counts only once the
// raw reading has agreed for 3 consecutive frames (100 ms at 30 fps, 66 ms
// of added latency since the third frame fires). One noisy frame can then
// never make a note, and a finger that flickers while it rises is still one
// note. While pinching, the thumb and index are part of the pinch, so their
// movement is not also read as finger lifts.
//
// Opening a pinch straightens the index, so for 6 frames after any pinch
// reading (one that counted or one that did not) the thumb and index only
// follow along: opening the pinch is not a note.
//
// The first frame of a hand only sets the baseline: a hand that arrives with
// fingers up plays nothing. If the hand leaves the frame mid-pinch, the held
// note is released so nothing hangs.

export type AirCue =
  | { kind: 'note'; t: number; finger: number }
  | { kind: 'hold'; t: number }
  | { kind: 'release'; t: number };

export interface AirOptions {
  /** Consecutive frames a change must hold to count */
  frames?: number;
  /** Frames without a hand before it counts as gone */
  lostFrames?: number;
  /** Play with one hand only, or whichever is in view */
  hand?: Handedness | 'any';
}

export interface AirPlay {
  push(frame: HandFrame): void;
  reset(): void;
  readonly holding: boolean;
}

export const AIR = { frames: 3, lostFrames: 3, settleFrames: 6 } as const;

/** A boolean that only changes after `frames` consecutive disagreeing readings. */
export class Debounced {
  private run = 0;

  constructor(
    public value: boolean,
    private readonly frames: number,
  ) {}

  /** Returns the new value when it flips, else null */
  push(raw: boolean): boolean | null {
    if (raw === this.value) {
      this.run = 0;
      return null;
    }
    if (++this.run < this.frames) return null;
    this.run = 0;
    this.value = raw;
    return raw;
  }

  /** Accept a reading as the new baseline without a change event */
  sync(raw: boolean): void {
    this.value = raw;
    this.run = 0;
  }
}

export function createAirPlay(onCue: (cue: AirCue) => void, opts: AirOptions = {}): AirPlay {
  const frames = opts.frames ?? AIR.frames;
  const lostFrames = opts.lostFrames ?? AIR.lostFrames;
  const want = opts.hand ?? 'any';

  let fingers: Debounced[] | null = null;
  let pinch = new Debounced(false, frames);
  let missing = 0;
  let lastHand: Handedness | null = null;
  /** Frames left in which the thumb and index settle after a pinch */
  let settle = 0;

  const choose = (hands: readonly TrackedHand[]): TrackedHand | undefined => {
    if (want !== 'any') return hands.find((h) => h.handedness === want);
    return hands.find((h) => h.handedness === lastHand) ?? hands[0];
  };

  const drop = (t: number): void => {
    if (pinch.value) onCue({ kind: 'release', t });
    fingers = null;
    pinch = new Debounced(false, frames);
    lastHand = null;
    settle = 0;
  };

  return {
    push(frame) {
      const { t } = frame;
      const hand = choose(frame.hands);
      if (!hand) {
        if (++missing >= lostFrames && fingers) drop(t);
        return;
      }
      missing = 0;
      lastHand = hand.handedness;

      if (!fingers) {
        fingers = hand.fingersUp.map((up) => new Debounced(up, frames));
        pinch.push(hand.pinch);
        return;
      }

      const flip = pinch.push(hand.pinch);
      if (flip === true) onCue({ kind: 'hold', t });
      if (flip === false) onCue({ kind: 'release', t });

      // The thumb and index belong to the pinch while it lasts, while it is
      // forming (even if it never counts), and while they settle after it.
      // Frozen during a held pinch; otherwise they track the hand silently.
      if (hand.pinch || pinch.value) settle = AIR.settleFrames;
      else if (settle > 0) settle--;
      const pinchOwnsThumbAndIndex = pinch.value || settle > 0;
      hand.fingersUp.forEach((up, i) => {
        const f = fingers?.[i];
        if (!f) return;
        if (i <= 1 && pinchOwnsThumbAndIndex) {
          if (!pinch.value) f.sync(up);
          return;
        }
        if (f.push(up) === true) onCue({ kind: 'note', t, finger: i });
      });
    },
    reset() {
      fingers = null;
      pinch = new Debounced(false, frames);
      missing = 0;
      lastHand = null;
      settle = 0;
    },
    get holding() {
      return pinch.value;
    },
  };
}
