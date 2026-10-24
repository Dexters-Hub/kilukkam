import { note, type ScoreEvent } from '../score.js';
import { harmonySpans, midiOf } from './originals/notation.js';

// Fingerstyle guitar for the arrangements: one monophonic line of broken
// chords, the bass string on every chord change and the upper strings after.

/** A chord shape per plan symbol: the bass string first, then the upper strings. */
export type Shapes = Readonly<Record<string, readonly string[]>>;

export interface Picking {
  /** Indexes into the shape, cycled; 0 is the bass string */
  order: readonly number[];
  /** Beats per plucked note */
  step: number;
  velocity: number;
  /** The bass string a touch louder, the way the thumb lands */
  bassVelocity?: number;
}

/**
 * Pluck every chord span of the plan: the pattern starts over at each change,
 * so the bass always falls on the change. Throws if a shape is missing or a
 * span does not divide into whole steps, so a slip fails when the module loads.
 */
export const fingerpick = (plan: readonly string[], shapes: Shapes, picking: Picking, beatsPerBar: number): ScoreEvent[] =>
  harmonySpans(plan, beatsPerBar).flatMap((span) => {
    const shape = shapes[span.chord.symbol];
    if (!shape) throw new Error(`no guitar shape for ${span.chord.symbol}`);
    const count = span.beats / picking.step;
    if (!Number.isInteger(count)) throw new Error(`${span.chord.symbol}: ${span.beats} beats do not divide into steps of ${picking.step}`);
    return Array.from({ length: count }, (_, i) => {
      const string = picking.order[i % picking.order.length] ?? 0;
      const name = shape[string];
      if (name === undefined) throw new Error(`${span.chord.symbol} shape has no string ${string}`);
      return note(midiOf(name), picking.step, string === 0 ? (picking.bassVelocity ?? picking.velocity) : picking.velocity);
    });
  });
