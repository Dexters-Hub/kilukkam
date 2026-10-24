import { note, rest, type ScoreEvent } from '../../score.js';

// A compact, readable way to write the originals as code, and the harmony
// plan every part is checked against.
//
// Melody notation: whitespace separated tokens, `|` between bars.
//   "E5:1.5 F#5:0.5 G5:2 | r:4"   note name and octave (middle C = C4),
//   then beats (quarter = 1, default 1); `r` is a rest.
// Every bar between bars lines must add up to `beatsPerBar`, so a slip of
// the pen fails loudly when the module loads instead of quietly
// shifting every later note off the beat.

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const TOKEN = /^(r|([A-G])([#b]?)(\d)):?(\d+(?:\.\d+)?)?$/;

/** "F#5" style name to MIDI number: C4 is 60. */
export const midiOf = (name: string): number => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  const base = m?.[1] === undefined ? undefined : PITCH[m[1]];
  if (!m || base === undefined) throw new Error(`bad note name: ${name}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + accidental;
};

/** Parse one or more bars of notation. Throws if any bar has the wrong length. */
export const bars = (src: string, velocity?: number, beatsPerBar = 4): ScoreEvent[] => {
  const out: ScoreEvent[] = [];
  src.split('|').forEach((bar, i) => {
    let sum = 0;
    for (const token of bar.trim().split(/\s+/).filter(Boolean)) {
      const m = TOKEN.exec(token);
      if (!m) throw new Error(`bad token "${token}" in bar ${i + 1}`);
      const beats = m[5] === undefined ? 1 : Number(m[5]);
      sum += beats;
      if (m[1] === 'r') out.push(rest(beats));
      else out.push(note(midiOf(`${m[2] ?? ''}${m[3] ?? ''}${m[4] ?? ''}`), beats, velocity));
    }
    if (sum !== beatsPerBar) throw new Error(`bar ${i + 1} of "${src.slice(0, 40)}" has ${sum} beats, expected ${beatsPerBar}`);
  });
  return out;
};

/** The same events moved by `semitones` (canon entries an octave apart). */
export const transpose = (events: readonly ScoreEvent[], semitones: number): ScoreEvent[] =>
  events.map((e) => (e.kind === 'note' ? { ...e, midi: e.midi + semitones } : { ...e }));

/** The same events with a new velocity: dynamics for a repeated section. */
export const withVelocity = (events: readonly ScoreEvent[], velocity: number): ScoreEvent[] =>
  events.map((e) => (e.kind === 'note' ? { ...e, velocity } : { ...e }));

// ---------- harmony ----------

const QUALITY: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
};

export interface Chord {
  symbol: string;
  /** Pitch class of the root, 0 = C */
  root: number;
  /** Pitch class in the bass: the root, or the note after a slash */
  bass: number;
  /** Every pitch class that belongs to the chord, bass included */
  tones: readonly number[];
}

const pitchClass = (name: string): number => {
  const pc = PITCH[name.charAt(0)];
  if (pc === undefined) throw new Error(`bad pitch: ${name}`);
  const accidental = name.charAt(1) === '#' ? 1 : name.charAt(1) === 'b' ? -1 : 0;
  return (pc + accidental + 12) % 12;
};

/** "Dm", "A", "B7", "G/D", "Em/G": triads and dominant sevenths, optional slash bass. */
export const chord = (symbol: string): Chord => {
  const m = /^([A-G][#b]?)(m|7)?(?:\/([A-G][#b]?))?$/.exec(symbol);
  const intervals = QUALITY[m?.[2] ?? ''];
  if (!m?.[1] || !intervals) throw new Error(`bad chord symbol: ${symbol}`);
  const root = pitchClass(m[1]);
  const bass = m[3] === undefined ? root : pitchClass(m[3]);
  const tones = [...new Set([bass, ...intervals.map((i) => (root + i) % 12)])];
  return { symbol, root, bass, tones };
};

export const pc = (midi: number): number => ((midi % 12) + 12) % 12;

/** A span of one chord: where it starts (beats from the top) and how long it lasts. */
export interface HarmonySpan {
  chord: Chord;
  at: number;
  beats: number;
}

/**
 * The harmony plan as written in each file header: one entry per bar,
 * "Dm" for a whole bar or "F G" for two chords splitting it evenly.
 */
export const harmonySpans = (plan: readonly string[], beatsPerBar = 4): HarmonySpan[] =>
  plan.flatMap((bar, i) => {
    const symbols = bar.trim().split(/\s+/);
    const each = beatsPerBar / symbols.length;
    return symbols.map((s, j) => ({ chord: chord(s), at: i * beatsPerBar + j * each, beats: each }));
  });

/**
 * Build a part from the plan: `cell` turns each chord span into notation for
 * exactly that span, so ostinatos and bass lines follow the harmony by construction.
 */
export const follow = (plan: readonly string[], cell: (chord: Chord, beats: number) => string, velocity?: number, beatsPerBar = 4): ScoreEvent[] =>
  harmonySpans(plan, beatsPerBar).flatMap((span) => bars(cell(span.chord, span.beats), velocity, span.beats));

/** Pick the note with this pitch class nearest above or at `floor` (MIDI). */
export const toneAbove = (pitch: number, floor: number): number => floor + ((pitch - pc(floor) + 12) % 12);

/** MIDI number back to the notation name, so generated cells read like the hand-written ones. */
export const nameOf = (midi: number): string => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return `${names[pc(midi)] ?? 'C'}${Math.floor(midi / 12) - 1}`;
};
