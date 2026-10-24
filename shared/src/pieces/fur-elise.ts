import type { Score, ScoreEvent } from '../score.js';
import { fingerpick, type Shapes } from './fingerstyle.js';
import { bars } from './originals/notation.js';

/*
 * Für Elise, Ludwig van Beethoven (1810): the A section. Public domain; this
 * arrangement is written fresh for Kilukkam.
 *
 * A minor, 3/8. A beat here is an eighth note: 3 beats a bar, 112 eighths a
 * minute, so the running sixteenths are about 0.27 s a tap. 43 bars, about
 * 69 seconds.
 *
 * Form:
 *   Intro    bar 1          one A minor broken chord, then the pickup
 *   Theme    bars 2 to 9    ends on the pickup back to the top
 *   Theme    bars 10 to 17  ends on the climb B C D into the bridge
 *   Bridge   bars 18 to 22  C, G, A minor, then E with the D sharp turns
 *   Theme    bars 23 to 30  climbs into the bridge again
 *   Bridge   bars 31 to 35
 *   Theme    bars 36 to 43  the last time, ending on a held A
 *
 * Piano   the right hand melody
 * Guitar  the left hand's broken chords, fingerstyle: bass, fifth, octave,
 *         third, octave, fifth; under the E D sharp turns only a light
 *         three-note chord
 * Cello   the root, one held note a bar; silent under the turns
 * Flute   a counter line in long notes from the second theme on; through
 *         the bridge it falls C, B, A, G sharp
 *
 * Harmony plan, one chord per bar:
 *   Intro   | Am |
 *   Theme   | E  | Am | E  | Am | E  | Am | E7 | Am |
 *   Bridge  | C  | G  | Am | E  | E  |
 */

const BPB = 3;

const THEME_PLAN = ['E', 'Am', 'E', 'Am', 'E', 'Am', 'E7', 'Am'];
const BRIDGE_PLAN = ['C', 'G', 'Am', 'E', 'E'];

export const furEliseHarmony: readonly string[] = ['Am', ...THEME_PLAN, ...THEME_PLAN, ...BRIDGE_PLAN, ...THEME_PLAN, ...BRIDGE_PLAN, ...THEME_PLAN];

// ---------- piano: the melody ----------

const TURN = 'E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5';
const THEME = [
  TURN,
  'A4:1.5 C4:0.5 E4:0.5 A4:0.5',
  'B4:1.5 E4:0.5 G#4:0.5 B4:0.5',
  'C5:1.5 E4:0.5 E5:0.5 D#5:0.5',
  TURN,
  'A4:1.5 C4:0.5 E4:0.5 A4:0.5',
  'B4:1.5 D4:0.5 C5:0.5 B4:0.5',
].join(' | ');
const TO_TOP = 'A4:1.5 r:0.5 E5:0.5 D#5:0.5';
const TO_BRIDGE = 'A4:1.5 B4:0.5 C5:0.5 D5:0.5';
const BRIDGE = [
  'E5:1.5 G4:0.5 F5:0.5 E5:0.5',
  'D5:1.5 F4:0.5 E5:0.5 D5:0.5',
  'C5:1.5 E4:0.5 D5:0.5 C5:0.5',
  'B4:1.5 E4:0.5 E5:0.5 D#5:0.5',
  'E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5',
].join(' | ');

const PIANO: ScoreEvent[] = bars(
  ['r:2 E5:0.5 D#5:0.5', THEME, TO_TOP, THEME, TO_BRIDGE, BRIDGE, THEME, TO_BRIDGE, BRIDGE, THEME, 'A4:3'].join(' | '),
  84,
  BPB,
);

// ---------- guitar: the left hand ----------

const SHAPES: Shapes = {
  Am: ['A2', 'E3', 'A3', 'C4'],
  E: ['E2', 'B2', 'E3', 'G#3'],
  E7: ['E2', 'B2', 'D3', 'G#3'],
  C: ['C3', 'G3', 'C4', 'E4'],
  G: ['G2', 'D3', 'G3', 'B3'],
};

const arp = (plan: readonly string[]): ScoreEvent[] =>
  fingerpick(plan, SHAPES, { order: [0, 1, 2, 3, 2, 1], step: 0.5, velocity: 58, bassVelocity: 70 }, BPB);

/** Under the E D sharp turn: just bass, fifth and octave, an eighth each. */
const LIGHT_E = bars('E2:1 B2:1 E3:1', 56, BPB);

const guitarTheme = (last: ScoreEvent[]): ScoreEvent[] => [
  ...LIGHT_E,
  ...arp(['Am', 'E', 'Am']),
  ...LIGHT_E,
  ...arp(['Am', 'E7']),
  ...last,
];
const guitarBridge = (): ScoreEvent[] => [...arp(['C', 'G', 'Am', 'E']), ...LIGHT_E];

const GUITAR: ScoreEvent[] = [
  ...arp(['Am']),
  ...guitarTheme(arp(['Am'])),
  ...guitarTheme(arp(['Am'])),
  ...guitarBridge(),
  ...guitarTheme(arp(['Am'])),
  ...guitarBridge(),
  ...guitarTheme(bars('A2:0.5 E3:0.5 A3:0.5 C4:1.5', 60, BPB)),
];

// ---------- cello: the roots ----------

const CELLO_THEME = 'r:3 | A2:3 | E2:3 | A2:3 | r:3 | A2:3 | E2:3 | A2:3';
const CELLO_BRIDGE = 'C3:3 | G2:3 | A2:3 | E2:3 | r:3';

const CELLO: ScoreEvent[] = bars(['r:3', CELLO_THEME, CELLO_THEME, CELLO_BRIDGE, CELLO_THEME, CELLO_BRIDGE, CELLO_THEME].join(' | '), 64, BPB);

// ---------- flute: the counter line ----------

const FLUTE_THEME = 'G#4:3 | A4:3 | G#4:3 | A4:1.5 C5:1.5 | B4:3 | C5:3 | D5:1.5 B4:1.5';
const FLUTE_BRIDGE = 'C5:3 | B4:3 | A4:3 | G#4:3 | B4:3';
const RESTS = Array.from({ length: 8 }, () => 'r:3').join(' | ');

const FLUTE: ScoreEvent[] = bars(
  ['r:3', RESTS, FLUTE_THEME, 'C5:3', FLUTE_BRIDGE, FLUTE_THEME, 'C5:3', FLUTE_BRIDGE, FLUTE_THEME, 'A4:3'].join(' | '),
  62,
  BPB,
);

export const furElise: Score = {
  id: 'fur-elise',
  title: 'Für Elise',
  composer: 'Ludwig van Beethoven',
  bpm: 112,
  beatsPerBar: BPB,
  tracks: [
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 25, events: PIANO },
    { id: 'guitar', name: 'Guitar', instrument: 'guitar', maxPlayers: 25, events: GUITAR },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 25, events: CELLO },
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 25, events: FLUTE },
  ],
};
