import type { Score, ScoreEvent } from '../../score.js';
import { bars, follow, nameOf, toneAbove, type Chord } from './notation.js';

/*
 * Pixel Plains: an original piece for Kilukkam.
 *
 * Mood: the first overworld. Green hills, a blue sky, a long walk to the
 * next castle. C major, 126 bpm, 4/4, 72 bars, about 2 minutes 17 seconds.
 * Written for the 8-bit voices (web/src/lib/voices/chip.ts) but it plays
 * today on the four orchestral instruments.
 *
 * Form:
 *   Intro   bars 1 to 4    arpeggios and bass alone
 *   A       bars 5 to 20   the theme on the flute (pulse lead), the violin
 *                          (second pulse) in half notes under it
 *   B       bars 21 to 36  call and response, two bars each; then both in
 *                          thirds through a bVII (Bb) "victory" turn; then a
 *                          one-bar relay climbing to the dominant
 *   Bonus   bars 37 to 48  a round over vi IV I V: the flute starts, the
 *                          violin follows four bars later at the same pitch
 *   A'      bars 49 to 64  the theme again, the violin now in thirds and
 *                          sixths under every note
 *   Outro   bars 65 to 72  the theme's head, a rising "stage clear" run with
 *                          the violin echoing an eighth behind, one last hit
 *
 * Who carries what:
 *   Flute   (pulse 12.5% on chip) the lead melody, the round's leader
 *   Violin  (pulse 25% on chip) harmony, the answers in B, the round's follower
 *   Piano   (pulse 50% or the arpeggio helper on chip) eighth-note broken
 *           chords up and down: root, 3rd, 5th, 8ve, 10th, 8ve, 5th, 3rd
 *   Cello   (triangle on chip) the bass: root, octave, fifth, octave in the
 *           A sections; a gallop (root, root, fifth, octave) in B and Bonus
 *   Drums   pixelPlainsDrums below, on the drum kit
 *
 * Harmony plan (one chord per bar; "F G" splits the bar):
 *   Intro  | C  | Am | F   | G   |
 *   A      | C  | G  | Am  | F   | C  | G  | F G | C   |   I V vi IV, then IV V I
 *          | C  | G  | Am  | F   | Dm | G7 | C   | C   |   ii V7 I
 *   B      | F  | G  | C   | Am  | F  | G  | C   | C   |   IV V I
 *          | Bb | F  | C   | Am  | Dm | Em | F   | G   |   bVII IV I, then a stepwise climb to V
 *   Bonus  | Am | F  | C   | G   | x3                      V to vi on entry, V to I on exit
 *   A'     as A
 *   Outro  | C  | Am | F   | G   | C  | F G | C  | C   |   IV V I: the final cadence
 *
 * Rule the parts obey: on beats 1 and 3 every sounding note is a tone of
 * the chord; passing notes live only between the beats. The tests check it.
 */

const INTRO = ['C', 'Am', 'F', 'G'];
const A = ['C', 'G', 'Am', 'F', 'C', 'G', 'F G', 'C', 'C', 'G', 'Am', 'F', 'Dm', 'G7', 'C', 'C'];
const B = ['F', 'G', 'C', 'Am', 'F', 'G', 'C', 'C', 'Bb', 'F', 'C', 'Am', 'Dm', 'Em', 'F', 'G'];
const GROUND = ['Am', 'F', 'C', 'G'];
const BONUS = [...GROUND, ...GROUND, ...GROUND];
const OUTRO = ['C', 'Am', 'F', 'G', 'C', 'F G', 'C', 'C'];

export const pixelPlainsHarmony: readonly string[] = [...INTRO, ...A, ...B, ...BONUS, ...A, ...OUTRO];

// ---------- flute: the lead ----------

const HEAD = 'E5:0.5 G5:0.5 C6:1 G5:0.5 E5:0.5 G5:1';
const PHRASE_1 = `${HEAD} | B5:1.5 A5:0.5 G5:1 D5:1 | C6:0.5 A5:0.5 E5:1 A5:0.5 E5:0.5 A5:1 | A5:1.5 G5:0.5 F5:1 C5:1`;
const PHRASE_2 = `${HEAD} | B5:1.5 D5:0.5 G5:2 | A5:1 C6:1 B5:1 G5:1 | C6:2 r:2`;
const PHRASE_4 = 'A5:1.5 F5:0.5 D5:1 F5:1 | D5:1 G5:1 B5:1 A5:1 | C6:2 G5:2 | r:4';
const THEME = [PHRASE_1, PHRASE_2, PHRASE_1, PHRASE_4].join(' | ');

const CALL = 'F5:0.5 A5:0.5 C6:1.5 A5:0.5 F5:1 | D5:0.5 G5:0.5 B5:1.5 A5:0.5 G5:1';

// Bonus round: R1 moves first and holds high; R2 holds low and moves late.
const R1 = 'E5:0.5 A5:0.5 C6:1 A5:2 | F5:0.5 G5:0.5 A5:1 C6:2 | C5:0.5 E5:0.5 G5:1 C6:2 | B5:0.5 A5:0.5 G5:1 B5:2';
const R2 = 'E5:2 C5:1 E5:1 | C5:2 A4:1 C5:1 | C5:2 E5:1 G5:1 | D5:2 B4:1 D5:1';

const FLUTE: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars(THEME, 96),
  ...bars(
    [
      `${CALL} | r:4 | r:4`,
      `${CALL} | r:4 | r:4`,
      'D5:1 F5:1 Bb5:2 | A5:1.5 G5:0.5 F5:1 C5:1 | E5:0.5 G5:0.5 C6:1 G5:1 E5:1 | A5:1.5 G5:0.5 E5:2',
      'r:4 | E5:0.5 G5:0.5 B5:1 G5:2 | r:4 | G5:0.5 A5:0.5 B5:0.5 C6:0.5 B5:1 G5:1',
    ].join(' | '),
    96,
  ),
  ...bars([R1, R2, R1].join(' | '), 92),
  ...bars(THEME, 104),
  ...bars(
    `${HEAD} | C6:0.5 A5:0.5 E5:1 A5:0.5 E5:0.5 A5:1 | A5:1.5 G5:0.5 F5:1 C5:1 | B5:1.5 A5:0.5 G5:1 D5:1 | E5:0.5 G5:0.5 C6:2 r:1 | A5:1 C6:1 B5:1 G5:1 | C5:0.5 E5:0.5 G5:0.5 C6:0.5 E5:0.5 G5:0.5 C6:1 | C6:1 r:3`,
    108,
  ),
];

// ---------- violin: the second voice ----------

/** A: half notes, the inner voice of each chord. */
const PADS = [
  'E5:2 C5:2 | D5:2 B4:2 | C5:2 A4:2 | C5:2 A4:2',
  'E5:2 C5:2 | D5:2 B4:2 | C5:2 D5:2 | E5:2 r:2',
  'E5:2 C5:2 | D5:2 B4:2 | C5:2 A4:2 | C5:2 A4:2',
  'D5:2 A4:2 | B4:2 D5:2 | C5:2 E5:2 | r:1 E5:0.5 F5:0.5 G5:1 r:1',
].join(' | ');

/** A': a third or a sixth under every note of the theme. */
const HEAD_THIRDS = 'C5:0.5 E5:0.5 G5:1 E5:0.5 C5:0.5 E5:1';
const THIRDS = [
  `${HEAD_THIRDS} | G5:1.5 F5:0.5 D5:1 B4:1 | A5:0.5 E5:0.5 C5:1 E5:0.5 C5:0.5 E5:1 | F5:1.5 D5:0.5 C5:1 A4:1`,
  `${HEAD_THIRDS} | G5:1.5 B4:0.5 D5:2 | F5:1 A5:1 G5:1 D5:1 | E5:2 r:2`,
  `${HEAD_THIRDS} | G5:1.5 F5:0.5 D5:1 B4:1 | A5:0.5 E5:0.5 C5:1 E5:0.5 C5:0.5 E5:1 | F5:1.5 D5:0.5 C5:1 A4:1`,
  'F5:1.5 D5:0.5 A4:1 D5:1 | B4:1 D5:1 G5:1 F5:1 | G5:2 E5:2 | r:1 E5:0.5 F5:0.5 G5:1 r:1',
].join(' | ');

const VIOLIN: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars(PADS, 80),
  ...bars(
    [
      'r:4 | r:4 | E5:0.5 G5:0.5 C6:1.5 G5:0.5 E5:1 | A5:0.5 C6:0.5 E6:1.5 C6:0.5 A5:1',
      'r:4 | r:4 | G5:0.5 E5:0.5 C5:1.5 E5:0.5 G5:1 | C6:2 r:2',
      'F5:1 Bb5:1 D6:2 | C6:1.5 Bb5:0.5 A5:1 F5:1 | G5:0.5 C6:0.5 E6:1 C6:1 G5:1 | C6:1.5 B5:0.5 A5:2',
      'D5:0.5 F5:0.5 A5:1 D6:2 | r:4 | F5:0.5 A5:0.5 C6:1 A5:2 | r:2 D6:2',
    ].join(' | '),
    92,
  ),
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars([R1, R2].join(' | '), 88),
  ...bars(THIRDS, 88),
  ...bars(
    `${HEAD_THIRDS} | A5:0.5 E5:0.5 C5:1 E5:0.5 C5:0.5 E5:1 | F5:1.5 D5:0.5 C5:1 A4:1 | G5:1.5 F5:0.5 D5:1 B4:1 | C5:0.5 E5:0.5 G5:2 r:1 | F5:1 A5:1 G5:1 D5:1 | r:0.5 C5:0.5 E5:0.5 G5:0.5 C6:0.5 E6:0.5 E6:1 | E6:1 r:3`,
    96,
  ),
];

// ---------- piano: arpeggios ----------

const thirdOf = (c: Chord): number => (c.tones.includes((c.root + 3) % 12) ? 3 : 4);

/** Up and down the chord in eighths; a half-bar chord goes up only. */
const arpeggio = (c: Chord, beats: number): string => {
  const r = toneAbove(c.root, 53);
  const t = r + thirdOf(c);
  const shape = beats === 4 ? [r, t, r + 7, r + 12, t + 12, r + 12, r + 7, t] : [r, t, r + 7, r + 12];
  return shape.map((m) => `${nameOf(m)}:0.5`).join(' ');
};

const PIANO: ScoreEvent[] = [
  ...follow(pixelPlainsHarmony.slice(0, -1), arpeggio, 76),
  ...bars('C4:1 r:3', 96),
];

// ---------- cello: the bass ----------

const bassNote = (c: Chord): number => toneAbove(c.bass, 36);

/** Root, octave, fifth, octave: the classic bouncing 8-bit bass. Half bars: root, octave. */
const bounce = (c: Chord, beats: number): string => {
  const r = bassNote(c);
  const notes = beats === 4 ? [r, r + 12, r + 7, r + 12] : [r, r + 12];
  return notes.map((m) => `${nameOf(m)}:1`).join(' ');
};

/** Root, root (a skip), fifth, octave: a gallop for the B section and the round. */
const gallop = (c: Chord): string => {
  const r = bassNote(c);
  return `${nameOf(r)}:1.5 ${nameOf(r)}:0.5 ${nameOf(r + 7)}:1 ${nameOf(r + 12)}:1`;
};

const CELLO: ScoreEvent[] = [
  ...follow([...INTRO, ...A], bounce, 96),
  ...follow([...B, ...BONUS], gallop, 96),
  ...follow([...A, ...OUTRO.slice(0, -1)], bounce, 100),
  ...bars('C2:1 r:3', 110),
];

// ---------- drums: for the chip noise channel ----------

// General MIDI drum numbers, which the chip kit reads: C2 (36) kick,
// D2 (38) snare, F#2 (42) closed hi-hat.
const GROOVE = 'C2:0.5 F#2:0.5 D2:0.5 F#2:0.5 C2:0.5 C2:0.5 D2:0.5 F#2:0.5';
const FILL = 'C2:0.5 F#2:0.5 D2:0.5 F#2:0.5 D2:0.5 D2:0.5 D2:0.5 D2:0.5';
const HALF_TIME = 'C2:1 F#2:1 D2:1 F#2:1';
const HATS = 'F#2:1 F#2:1 F#2:1 F#2:1';
const eight = `${Array.from({ length: 7 }, () => GROOVE).join(' | ')} | ${FILL}`;

/** The drum part, as long as every other part, played on the drum kit as the fifth instrument. */
export const pixelPlainsDrums: readonly ScoreEvent[] = [
  ...bars(`${HATS} | ${HATS} | ${GROOVE} | ${FILL}`, 90),
  ...bars([eight, eight, eight, eight].join(' | '), 96),
  ...bars(`${Array.from({ length: 11 }, () => HALF_TIME).join(' | ')} | ${FILL}`, 90),
  ...bars([eight, eight].join(' | '), 100),
  ...bars(`${Array.from({ length: 6 }, () => GROOVE).join(' | ')} | ${FILL} | C2:1 r:3`, 104),
];

export const pixelPlains: Score = {
  id: 'pixel-plains',
  title: 'Pixel Plains',
  composer: 'Kilukkam Originals',
  bpm: 126,
  beatsPerBar: 4,
  tracks: [
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 20, events: FLUTE },
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 20, events: VIOLIN },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 20, events: PIANO },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 20, events: CELLO },
    { id: 'drums', name: 'Drums', instrument: 'drums', maxPlayers: 20, events: [...pixelPlainsDrums] },
  ],
};
