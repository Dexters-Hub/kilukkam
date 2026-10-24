import type { Score, ScoreEvent } from '../../score.js';
import { bars, follow, nameOf, toneAbove, transpose, type Chord } from './notation.js';

/*
 * Hallowed Depths: an original piece for Kilukkam.
 *
 * Mood: a quiet kingdom far underground. Lantern light, falling dust, a
 * lone wanderer. D Dorian (D minor with a raised sixth, B natural), so the
 * G major chord glows warm against the minor tonic. 66 bpm, 4/4, 38 bars,
 * about 2 minutes 18 seconds.
 *
 * Form:
 *   Intro   bars 1 to 4    piano music box over a low cello drone on D
 *   A       bars 5 to 12   the flute alone sings the theme (m1, then its
 *                          answer m2); the violin enters as a soft pad
 *   B       bars 13 to 20  a descending lament bass; violin calls, flute
 *                          answers (call and response, two bars each)
 *   A'      bars 21 to 32  a canon: the flute plays m1, m2, m3 and the
 *                          violin follows four bars behind, an octave down,
 *                          so the room hears the theme pass between them
 *   Outro   bars 33 to 38  the motif once more, the violin climbs C# to D,
 *                          the flute fades on the open fifth, piano alone
 *
 * Who carries what:
 *   Flute   the lonely melody (A, answers in B, canon leader)
 *   Violin  swells and pads, the calls in B, the canon follower
 *   Piano   the ostinato: root, fifth, octave, then the third held high,
 *           one four-note cell per chord, quiet and constant
 *   Cello   drones and the bass line: pedal D, whole-note roots, the
 *           stepwise lament F E D C B A G A, then root and fifth in A'
 *
 * Harmony plan (one chord per bar):
 *   Intro  | Dm  | Dm   | G/D | G/D  |                       i, Dorian IV over the pedal
 *   A      | Dm  | C    | G   | A    | Dm | C   | G    | A    i bVII IV V: half cadence
 *   B      | F   | C/E  | Dm  | Am/C | G/B | Dm/A | Em/G | A   lament bass, ends on V
 *   A'     | Dm  | C    | G   | A    | x3, the same ground under the canon
 *   Outro  | Dm  | C    | G   | A    | Dm | Dm |              V to i: the final cadence
 *
 * Rule the parts obey: on beats 1 and 3 every sounding note is a tone of
 * the bar's chord; passing steps live only on off beats. The tests check it.
 */

const GROUND = ['Dm', 'C', 'G', 'A'];

export const hallowedDepthsHarmony: readonly string[] = [
  'Dm', 'Dm', 'G/D', 'G/D',
  ...GROUND, ...GROUND,
  'F', 'C/E', 'Dm', 'Am/C', 'G/B', 'Dm/A', 'Em/G', 'A',
  ...GROUND, ...GROUND, ...GROUND,
  ...GROUND, 'Dm', 'Dm',
];

const INTRO = hallowedDepthsHarmony.slice(0, 4);
const B_PLAN = hallowedDepthsHarmony.slice(12, 20);
const OUTRO = hallowedDepthsHarmony.slice(32);

// ---------- flute and violin: the theme ----------

/** m1: three falling gestures (A G F, E C G, B A G), then a rising question on A. */
const M1 = 'A5:1.5 G5:0.5 F5:2 | E5:1.5 C5:0.5 G5:2 | B5:1.5 A5:0.5 G5:2 | E5:1 A5:3';
/** m2: the answer. It holds where m1 moves and moves where m1 holds, so the two can sound together. */
const M2 = 'F5:2 A5:1 D5:1 | C5:2 G5:1 E5:1 | G5:2 B5:2 | A5:2 E5:1 C#5:1';
/** m3: m1 opened out, climbing to the piece's highest note (C6). */
const M3 = 'A5:1.5 G5:0.5 F5:1 A5:1 | G5:1.5 A5:0.5 C6:2 | B5:1.5 A5:0.5 G5:1 B5:1 | A5:4';

const FLUTE: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars(M1, 80),
  ...bars(M2, 84),
  // B: rest through the violin's calls, answer each with the m1 motif
  ...bars('r:4 | r:4'),
  ...bars('A5:1.5 G5:0.5 F5:2 | E5:1.5 D5:0.5 C5:2', 78),
  ...bars('r:4 | r:4'),
  ...bars('B5:1.5 A5:0.5 G5:2 | A5:2 E5:2', 82),
  // A': canon leader
  ...bars(M1, 84),
  ...bars(M2, 88),
  ...bars(M3, 96),
  // Outro: the motif, then the open fifth
  ...bars('A5:1.5 G5:0.5 F5:2 | E5:1.5 C5:0.5 G5:2 | D5:4 | E5:4', 72),
  ...bars('A5:4 | r:4', 60),
];

const VIOLIN: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars('r:4 | r:4 | r:4 | r:4'),
  // A, second half: a pad that swells under the flute's answer
  ...bars('D4:4', 44), ...bars('E4:4', 52), ...bars('D4:4', 60), ...bars('C#4:4', 68),
  // B: two calls, each a rising arpeggio that falls back; long notes under the answers
  ...bars('C5:1 F5:1 A5:2', 70), ...bars('G5:1.5 F5:0.5 E5:2', 84),
  ...bars('A4:4 | E4:4', 52),
  ...bars('D5:1 G5:1 B5:2', 78), ...bars('A5:2 F5:1 D5:1', 92),
  ...bars('E5:4 | E5:2 C#5:2', 60),
  // A': the canon follower, four bars behind and an octave below
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...transpose(bars(M1, 76), -12),
  ...transpose(bars(M2, 84), -12),
  // Outro: a slow climb to the leading tone and home
  ...bars('A4:4 | G4:4 | D4:4 | C#4:4', 64),
  ...bars('D4:4 | r:4', 56),
];

// ---------- piano: the music-box ostinato ----------

/** Root, fifth, octave (G: root, third, fifth), then the third held high: chord tones only. */
const CELL: Record<string, string> = {
  Dm: 'D4:1 A4:0.5 D5:0.5 F5:2',
  C: 'C4:1 G4:0.5 C5:0.5 E5:2',
  G: 'G3:1 B3:0.5 D4:0.5 B4:2',
  A: 'A3:1 E4:0.5 A4:0.5 C#5:2',
  F: 'F3:1 C4:0.5 F4:0.5 A4:2',
  Am: 'A3:1 E4:0.5 A4:0.5 C5:2',
  Em: 'E3:1 B3:0.5 E4:0.5 G4:2',
};

const cell = (c: Chord): string => {
  const src = CELL[c.symbol.split('/')[0] ?? ''];
  if (!src) throw new Error(`no piano cell for ${c.symbol}`);
  return src;
};

const PIANO: ScoreEvent[] = [
  ...follow(hallowedDepthsHarmony.slice(0, -1), cell, 60),
  ...bars('D4:1 A4:1 D5:2', 52),
];

// ---------- cello: drones and the bass line ----------

/** One whole note on the chord's bass, placed at or above `floor`. */
const drone = (floor: number) => (c: Chord): string => `${nameOf(toneAbove(c.bass, floor))}:4`;

/** Root then fifth, the fifth folded down when it would climb past E3. */
const rootFifth = (c: Chord): string => {
  const root = toneAbove(c.root, 43);
  const fifth = root + 7 <= 52 ? root + 7 : root - 5;
  return `${nameOf(root)}:2 ${nameOf(fifth)}:2`;
};

const CELLO: ScoreEvent[] = [
  ...follow(INTRO, drone(36), 70),
  ...follow([...GROUND, ...GROUND], drone(36), 74),
  ...follow(B_PLAN, drone(43), 78),
  ...follow([...GROUND, ...GROUND, ...GROUND], rootFifth, 80),
  ...follow(OUTRO, drone(36), 70),
];

export const hallowedDepths: Score = {
  id: 'hallowed-depths',
  title: 'Hallowed Depths',
  composer: 'Kilukkam Originals',
  bpm: 66,
  beatsPerBar: 4,
  tracks: [
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 25, events: FLUTE },
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 25, events: VIOLIN },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 25, events: PIANO },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 25, events: CELLO },
  ],
};
