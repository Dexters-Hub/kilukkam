import type { Score, ScoreEvent } from '../score.js';
import { fingerpick, type Shapes } from './fingerstyle.js';
import { bars, follow, type Chord } from './originals/notation.js';

/*
 * Greensleeves, traditional English. Public domain; this arrangement is
 * written fresh for Kilukkam.
 *
 * A minor, 3/4, 96 bpm, 52 bars, about 98 seconds.
 *
 * Form:
 *   Intro   bars 1 to 4    guitar and cello; the flute's pickup in bar 4
 *   Verse   bars 5 to 20   the tune on the flute
 *   Chorus  bars 21 to 36  "Greensleeves was all my joy"
 *   Chorus  bars 37 to 52  again, the piano an octave higher, louder
 *
 * Flute   the melody
 * Guitar  fingerstyle broken chords in eighths: bass, fifth, octave, third,
 *         octave, fifth
 * Cello   the root on every bar; root and fifth in the choruses
 * Piano   light chords on beats 2 and 3, from the verse on
 *
 * Harmony plan, one chord per bar:
 *   Intro   | Am | G  | Am | E  |
 *   Verse   | Am | C  | G  | Em | Am | Am | E  | E  |
 *           | Am | C  | G  | Em | Am | E  | Am | Am |
 *   Chorus  | C  | C  | G  | Em | Am | Am | E  | E  |
 *           | C  | C  | G  | Em | Am | E  | Am | Am |   twice
 */

const INTRO = ['Am', 'G', 'Am', 'E'];
const VERSE = ['Am', 'C', 'G', 'Em', 'Am', 'Am', 'E', 'E', 'Am', 'C', 'G', 'Em', 'Am', 'E', 'Am', 'Am'];
const CHORUS = ['C', 'C', 'G', 'Em', 'Am', 'Am', 'E', 'E', 'C', 'C', 'G', 'Em', 'Am', 'E', 'Am', 'Am'];

export const greensleevesHarmony: readonly string[] = [...INTRO, ...VERSE, ...CHORUS, ...CHORUS];

const BPB = 3;

// ---------- flute: the tune ----------

const HALF_A = 'C5:2 D5:1 | E5:1.5 F5:0.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:0.5 B4:1';
const HALF_B = 'G5:3 | G5:1.5 F#5:0.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:0.5 B4:1';
const OPEN = 'C5:2 A4:1 | A4:1.5 G#4:0.5 A4:1 | B4:2 G#4:1';
const CLOSE = 'C5:1.5 B4:0.5 A4:1 | G#4:1.5 F#4:0.5 G#4:1 | A4:3';

const FLUTE: ScoreEvent[] = [
  ...bars('r:3 | r:3 | r:3 | r:2 A4:1', 84, BPB),
  ...bars(`${HALF_A} | ${OPEN} | E4:2 A4:1 | ${HALF_A} | ${CLOSE} | A4:2 r:1`, 88, BPB),
  ...bars(`${HALF_B} | ${OPEN} | E4:3 | ${HALF_B} | ${CLOSE} | A4:2 r:1`, 92, BPB),
  ...bars(`${HALF_B} | ${OPEN} | E4:3 | ${HALF_B} | ${CLOSE} | r:3`, 100, BPB),
];

// ---------- guitar: fingerstyle ----------

const SHAPES: Shapes = {
  Am: ['A2', 'E3', 'A3', 'C4'],
  C: ['C3', 'G3', 'C4', 'E4'],
  G: ['G2', 'D3', 'G3', 'B3'],
  Em: ['E2', 'B2', 'E3', 'G3'],
  E: ['E2', 'B2', 'E3', 'G#3'],
};

const GUITAR = fingerpick(greensleevesHarmony, SHAPES, { order: [0, 1, 2, 3, 2, 1], step: 0.5, velocity: 66, bassVelocity: 80 }, BPB);

// ---------- cello and piano: from the same chord tables ----------

const pick = <T>(table: Readonly<Record<string, T>>, c: Chord): T => {
  const v = table[c.symbol];
  if (v === undefined) throw new Error(`no entry for ${c.symbol}`);
  return v;
};

/** Root and the fifth above it. */
const BASS: Readonly<Record<string, readonly [string, string]>> = {
  Am: ['A2', 'E3'],
  C: ['C3', 'G3'],
  G: ['G2', 'D3'],
  Em: ['E2', 'B2'],
  E: ['E2', 'B2'],
};

const CELLO: ScoreEvent[] = [
  ...follow([...INTRO, ...VERSE], (c) => `${pick(BASS, c)[0]}:3`, 74, BPB),
  ...follow([...CHORUS, ...CHORUS], (c) => `${pick(BASS, c)[0]}:2 ${pick(BASS, c)[1]}:1`, 82, BPB),
];

/** The two upper chord tones the piano answers with, low to high. */
const UPPER: Readonly<Record<string, readonly [string, string]>> = {
  Am: ['C4', 'E4'],
  C: ['E4', 'G4'],
  G: ['B3', 'D4'],
  Em: ['G3', 'B3'],
  E: ['G#3', 'B3'],
};

const UPPER_HIGH: Readonly<Record<string, readonly [string, string]>> = {
  Am: ['C5', 'E5'],
  C: ['E5', 'G5'],
  G: ['B4', 'D5'],
  Em: ['G4', 'B4'],
  E: ['G#4', 'B4'],
};

const PIANO: ScoreEvent[] = [
  ...bars('r:3 | r:3 | r:3 | r:3', undefined, BPB),
  ...follow([...VERSE, ...CHORUS], (c) => `r:1 ${pick(UPPER, c).join(' ')}`, 62, BPB),
  ...follow(CHORUS, (c) => `r:1 ${pick(UPPER_HIGH, c).join(' ')}`, 70, BPB),
];

export const greensleeves: Score = {
  id: 'greensleeves',
  title: 'Greensleeves',
  composer: 'Traditional',
  bpm: 96,
  beatsPerBar: BPB,
  tracks: [
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 25, events: FLUTE },
    { id: 'guitar', name: 'Guitar', instrument: 'guitar', maxPlayers: 25, events: GUITAR },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 25, events: CELLO },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 25, events: PIANO },
  ],
};
