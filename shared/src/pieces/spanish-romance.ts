import { note, type Score, type ScoreEvent } from '../score.js';
import { bars, midiOf } from './originals/notation.js';

/*
 * Romance (Spanish Romance), anonymous, 19th century. Public domain; this
 * arrangement is written fresh for Kilukkam.
 *
 * E minor, 3/4, 66 bpm, 32 bars: the minor section played twice, about
 * 87 seconds. The E major middle section is left out.
 *
 * Guitar  the famous line: every beat is a triplet of melody note, then two
 *         inner strings, so one tap per triplet note (about 0.3 s)
 * Violin  the top line: one held note per bar the first time through (from
 *         bar 5), every melody note the second time
 * Cello   the bass the guitar's thumb would play: the root each bar, then
 *         root and fifth the second time
 *
 * Harmony plan, one chord per bar:
 *   | Em | Em | Em | Em | Em | Em | Am | Am |
 *   | B7 | B7 | Em | Em | B7 | B7 | Em | Em |   twice
 */

/** One bar of the minor section: chord, the three melody notes, the two inner strings (high, low). */
type RomanceBar = readonly [chord: string, melody: readonly [string, string, string], inner: readonly [string, string]];

const SECTION: readonly RomanceBar[] = [
  ['Em', ['B4', 'B4', 'B4'], ['B3', 'G3']],
  ['Em', ['B4', 'A4', 'G4'], ['B3', 'G3']],
  ['Em', ['G4', 'F#4', 'E4'], ['B3', 'G3']],
  ['Em', ['E4', 'G4', 'B4'], ['B3', 'G3']],
  ['Em', ['E5', 'E5', 'E5'], ['B4', 'G4']],
  ['Em', ['E5', 'D5', 'C5'], ['B4', 'G4']],
  ['Am', ['C5', 'B4', 'A4'], ['E4', 'C4']],
  ['Am', ['A4', 'B4', 'C5'], ['E4', 'C4']],
  ['B7', ['B4', 'C5', 'B4'], ['F#4', 'D#4']],
  ['B7', ['D#5', 'C5', 'B4'], ['F#4', 'D#4']],
  ['Em', ['B4', 'A4', 'G4'], ['E4', 'B3']],
  ['Em', ['G4', 'F#4', 'E4'], ['B3', 'G3']],
  ['B7', ['F#4', 'F#4', 'F#4'], ['B3', 'A3']],
  ['B7', ['F#4', 'G4', 'F#4'], ['B3', 'A3']],
  ['Em', ['E4', 'E4', 'E4'], ['B3', 'G3']],
  ['Em', ['E4', 'E4', 'E4'], ['B3', 'G3']],
];

export const spanishRomanceHarmony: readonly string[] = [...SECTION, ...SECTION].map(([c]) => c);

const THIRD = 1 / 3;

/** The triplet figure: melody, high inner string, low inner string, on every beat. */
const triplets = (bar: RomanceBar, velocity: number): ScoreEvent[] =>
  bar[1].flatMap((m) => [note(midiOf(m), THIRD, velocity), note(midiOf(bar[2][0]), THIRD, 56), note(midiOf(bar[2][1]), THIRD, 50)]);

const GUITAR: ScoreEvent[] = [
  ...SECTION.flatMap((b) => triplets(b, 86)),
  ...SECTION.slice(0, -1).flatMap((b) => triplets(b, 94)),
  note(midiOf('E4'), 3, 80), // the last bar rings
];

const VIOLIN: ScoreEvent[] = [
  ...bars('r:3 | r:3 | r:3 | r:3', undefined, 3),
  ...SECTION.slice(4).flatMap(([, m]) => bars(`${m[0]}:3`, 68, 3)),
  ...SECTION.flatMap(([, m], i) => bars(i === SECTION.length - 1 ? `${m[0]}:3` : m.join(' '), 84, 3)),
];

const ROOT: Readonly<Record<string, readonly [string, string]>> = {
  Em: ['E2', 'B2'],
  Am: ['A2', 'E3'],
  B7: ['B2', 'F#2'],
};

const rootOf = (c: string): readonly [string, string] => {
  const r = ROOT[c];
  if (!r) throw new Error(`no bass for ${c}`);
  return r;
};

const CELLO: ScoreEvent[] = [
  ...SECTION.flatMap(([c]) => bars(`${rootOf(c)[0]}:3`, 72, 3)),
  ...SECTION.flatMap(([c], i) => bars(i === SECTION.length - 1 ? `${rootOf(c)[0]}:3` : `${rootOf(c)[0]}:2 ${rootOf(c)[1]}:1`, 80, 3)),
];

export const spanishRomance: Score = {
  id: 'spanish-romance',
  title: 'Romance',
  composer: 'Anonymous',
  bpm: 66,
  beatsPerBar: 3,
  tracks: [
    { id: 'guitar', name: 'Guitar', instrument: 'guitar', maxPlayers: 30, events: GUITAR },
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 30, events: VIOLIN },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 30, events: CELLO },
  ],
};
