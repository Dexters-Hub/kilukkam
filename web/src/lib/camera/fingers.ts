import { Debounced, AIR } from './air.js';
import type { HandFrame, Handedness } from './features.js';

/*
 * Finger play, the "ten fingers, ten voices" model: every finger of both
 * hands owns one voice. Raising a finger starts its note and holds it;
 * lowering it lets the note go. Each finger is debounced like air play (a
 * change counts after 3 agreeing frames), and a hand that appears with
 * fingers already up only sets the baseline, so nothing blurts out.
 *
 * The voice map is chosen so any combination sounds good together: the left
 * hand holds the chord roots of the key (I, IV, V, vi, ii, low), and the
 * right hand the major pentatonic above them (no semitone clashes).
 */

export const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

export type FingerCue =
  | { kind: 'down'; t: number; hand: Handedness; finger: number }
  | { kind: 'up'; t: number; hand: Handedness; finger: number };

export interface FingerVoice {
  midi: number;
  /** Shown on the fingertip and in the finger map, e.g. "C3" or "Am" */
  label: string;
  /** A chord root in the left hand, a melody note in the right */
  role: 'chord' | 'melody';
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const noteLabel = (midi: number) => `${NAMES[((midi % 12) + 12) % 12] ?? '?'}${Math.floor(midi / 12) - 1}`;

/** The ten voices for a major key with tonic `tonic` (pitch class 0..11). Thumb to pinky, left then right. */
export const voicesFor = (tonic = 0): Record<Handedness, readonly FingerVoice[]> => {
  const root = 48 + tonic; // the tonic around C3
  const chords: [number, string][] = [
    [0, ''],
    [5, ''],
    [7, ''],
    [9, 'm'],
    [2, 'm'],
  ];
  const pentatonic = [0, 2, 4, 7, 9];
  return {
    left: chords.map(([step, quality]) => ({
      midi: root + step - (step > 7 ? 12 : 0),
      label: `${NAMES[(tonic + step) % 12] ?? '?'}${quality}`,
      role: 'chord' as const,
    })),
    right: pentatonic.map((step) => ({ midi: root + 24 + step, label: noteLabel(root + 24 + step), role: 'melody' as const })),
  };
};

export interface FingerPlay {
  push(frame: HandFrame): void;
  reset(): void;
  /** Fingers currently up and sounding, as "left:1" keys */
  readonly active: ReadonlySet<string>;
}

export const fingerKey = (hand: Handedness, finger: number): string => `${hand}:${finger}`;

export function createFingerPlay(onCue: (cue: FingerCue) => void, frames: number = AIR.frames): FingerPlay {
  const state = new Map<Handedness, { fingers: Debounced[]; missing: number }>();
  const active = new Set<string>();

  const releaseHand = (hand: Handedness, t: number) => {
    for (let f = 0; f < 5; f++) {
      const key = fingerKey(hand, f);
      if (active.delete(key)) onCue({ kind: 'up', t, hand, finger: f });
    }
  };

  return {
    push(frame) {
      const seen = new Set<Handedness>();
      for (const hand of frame.hands) {
        seen.add(hand.handedness);
        let s = state.get(hand.handedness);
        if (!s) {
          // First sight of this hand: its current fingers are the baseline, not notes.
          s = { fingers: hand.fingersUp.map((up) => new Debounced(up, frames)), missing: 0 };
          state.set(hand.handedness, s);
          continue;
        }
        s.missing = 0;
        hand.fingersUp.forEach((up, f) => {
          const flipped = s.fingers[f]?.push(up);
          if (flipped === null || flipped === undefined) return;
          const key = fingerKey(hand.handedness, f);
          if (flipped) {
            active.add(key);
            onCue({ kind: 'down', t: frame.t, hand: hand.handedness, finger: f });
          } else if (active.delete(key)) {
            onCue({ kind: 'up', t: frame.t, hand: hand.handedness, finger: f });
          }
        });
      }
      // A hand that leaves the frame lets its notes go and starts fresh when it returns.
      for (const [handed, s] of state) {
        if (seen.has(handed)) continue;
        if (++s.missing >= AIR.lostFrames) {
          releaseHand(handed, frame.t);
          state.delete(handed);
        }
      }
    },
    reset() {
      state.clear();
      active.clear();
    },
    get active() {
      return active;
    },
  };
}
