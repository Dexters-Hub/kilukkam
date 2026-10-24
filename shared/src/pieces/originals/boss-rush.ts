import type { Score, ScoreEvent } from '../../score.js';
import { bars, follow, nameOf, toneAbove, transpose, withVelocity, type Chord } from './notation.js';

/*
 * Boss Rush: an original piece for Kilukkam.
 *
 * Mood: the health bar appears, the floor shakes, and the whole room fights
 * one battle together. E minor (D# leading tone on the B major dominant),
 * 150 bpm, 4/4, 88 bars, about 2 minutes 21 seconds.
 *
 * Form:
 *   Intro      bars 1 to 8    the cello heartbeat alone, then the piano
 *                             engine; the violin climbs a warning line
 *   A          bars 9 to 24   the heroic violin theme; the flute answers
 *                             every phrase with a falling run (call and
 *                             response), then both cadence together
 *   B          bars 25 to 40  the relative major opens up; flute and violin
 *                             swap roles, two bars each, then join in thirds
 *   Phase 2    bars 41 to 56  a round over the falling ground Em D C B: the
 *                             flute starts, the violin enters four bars later
 *                             an octave down, and the two lines interlock
 *   Build      bars 57 to 64  a one-bar relay, violin then flute, rising to
 *                             the dominant
 *   A'         bars 65 to 80  the theme again at full force, the flute
 *                             holding a line under the calls
 *   Outro      bars 81 to 88  the theme's tail, tresillo hits on B7, then on
 *                             E minor, and one last stab
 *
 * Who carries what:
 *   Violin  the heroic theme and the calls
 *   Flute   the answers (falling runs), the round's leader
 *   Piano   the engine: straight eighths grouped 3+3+2 (root, fifth, third),
 *           which pulls against the beat; off-beat pumps in B; quarter
 *           arpeggios in Phase 2
 *   Cello   the heartbeat: a tresillo (dotted quarter, dotted quarter,
 *           quarter) on root, root, fifth in every bar; octave quarters in
 *           the Build
 *
 * Harmony plan (one chord per bar):
 *   Intro    | Em | Em | C  | C  | Em | Em | B  | B   |
 *   A        | Em | C  | D  | Em | Em | C  | Am | B   |   i bVI bVII i, then a half cadence
 *            | Em | C  | D7 | G  | C  | Am | B  | Em  |   to the relative major, then iv V i
 *   B        | C  | D  | G  | Em | C  | D  | B  | B7  |
 *            | C  | D  | G  | Em | Am | C  | B  | B7  |   ends on V7
 *   Phase 2  | Em | D  | C  | B   | x4                   the falling ground, V at every turn
 *   Build    | C  | D7 | Em | Em | C  | D7 | B  | B7  |
 *   A'       as A
 *   Outro    | C  | D  | B  | B7 | Em | Em | Em | Em  |   V7 to i: the final cadence
 *
 * Rule the parts obey: on beats 1 and 3 every sounding note is a tone of
 * the bar's chord; passing notes live only between the beats. The tests check it.
 */

const INTRO = ['Em', 'Em', 'C', 'C', 'Em', 'Em', 'B', 'B'];
const A = ['Em', 'C', 'D', 'Em', 'Em', 'C', 'Am', 'B', 'Em', 'C', 'D7', 'G', 'C', 'Am', 'B', 'Em'];
const B = ['C', 'D', 'G', 'Em', 'C', 'D', 'B', 'B7', 'C', 'D', 'G', 'Em', 'Am', 'C', 'B', 'B7'];
const GROUND = ['Em', 'D', 'C', 'B'];
const PHASE_2 = [...GROUND, ...GROUND, ...GROUND, ...GROUND];
const BUILD = ['C', 'D7', 'Em', 'Em', 'C', 'D7', 'B', 'B7'];
const OUTRO = ['C', 'D', 'B', 'B7', 'Em', 'Em', 'Em', 'Em'];

export const bossRushHarmony: readonly string[] = [...INTRO, ...A, ...B, ...PHASE_2, ...BUILD, ...A, ...OUTRO];

// ---------- violin and flute ----------

// A: four phrases. The violin calls, the flute answers in the gaps.
const THEME_1 = 'B4:1 E5:1.5 G5:1.5 | C6:1.5 B5:0.5 G5:1 E5:1 | D6:1.5 A5:1.5 F#5:1 | E5:1 r:3';
const THEME_2 = 'B4:1 E5:1.5 G5:1.5 | C6:1.5 B5:0.5 G5:1 E5:1 | E5:1.5 A5:1.5 C6:1 | B5:1 r:3';
const THEME_3 = 'E5:0.5 G5:0.5 B5:2 G5:1 | E6:1.5 D6:0.5 C6:2 | r:4 | r:3 D5:1';
const THEME_4 = 'G5:1.5 E5:0.5 G5:1 C6:1 | C6:1.5 B5:0.5 A5:1 E5:1 | F#5:1 B5:1 D#6:2 | E6:2 r:2';

/** The answer: a falling run, landing on the tonic or on the leading tone. */
const RUN_HOME = 'r:1 B5:0.5 A5:0.5 G5:1 E5:1';
const RUN_TO_LEADING_TONE = 'r:1 B5:0.5 A5:0.5 F#5:1 D#5:1';
const ANSWER_3 = 'A5:1.5 F#5:0.5 A5:1 C6:1 | B5:1.5 A5:0.5 G5:2';
/** Phrase 4: the flute a third or sixth under the violin, cadencing together. */
const THIRDS_4 = 'E5:1.5 C5:0.5 E5:1 G5:1 | A5:1.5 G5:0.5 E5:1 C5:1 | D#5:1 F#5:1 B5:2 | G5:2 r:2';

const A_VIOLIN = (v: number): ScoreEvent[] => bars([THEME_1, THEME_2, THEME_3, THEME_4].join(' | '), v);

const A_FLUTE: ScoreEvent[] = bars(
  [`r:4 | r:4 | r:4 | ${RUN_HOME}`, `r:4 | r:4 | r:4 | ${RUN_TO_LEADING_TONE}`, `r:4 | r:4 | ${ANSWER_3}`, THIRDS_4].join(' | '),
  92,
);

/** A' flute: long notes under the calls, then the same answers. */
const A2_FLUTE: ScoreEvent[] = bars(
  [
    `E5:4 | G5:4 | F#5:4 | ${RUN_HOME}`,
    `E5:4 | G5:4 | E5:4 | ${RUN_TO_LEADING_TONE}`,
    `E5:4 | G5:4 | ${ANSWER_3}`,
    THIRDS_4,
  ].join(' | '),
  100,
);

// B: the flute calls, the violin answers, then they join in thirds.
const B_CALL = 'G5:1.5 E5:0.5 G5:1 C6:1';
const B_FLUTE: ScoreEvent[] = bars(
  [
    `${B_CALL} | A5:1.5 F#5:0.5 D5:2 | D5:4 | E5:4`,
    `${B_CALL} | A5:1.5 F#5:0.5 A5:2 | D#5:4 | D#5:4`,
    `${B_CALL} | A5:1.5 F#5:0.5 D5:2 | D5:4 | E5:4`,
    'E5:1 A5:1 C6:2 | C6:1.5 B5:0.5 G5:1 E5:1 | D#5:1 F#5:1 B5:2 | F#5:1 D#5:1 F#5:1 A5:1',
  ].join(' | '),
  96,
);
const B_ANSWER = 'D6:1.5 B5:0.5 G5:1 B5:1 | E6:1.5 D6:0.5 B5:2';
const B_VIOLIN: ScoreEvent[] = bars(
  [
    `C5:4 | D5:4 | ${B_ANSWER}`,
    'C5:4 | D5:4 | F#5:1 B5:1 D#6:2 | B5:1.5 A5:0.5 F#5:2',
    `C5:4 | D5:4 | ${B_ANSWER}`,
    'A5:1 C6:1 E6:2 | E6:1.5 D6:0.5 C6:1 G5:1 | F#5:1 B5:1 D#6:2 | D#6:1 B5:1 A5:1 F#5:1',
  ].join(' | '),
  100,
);

// Phase 2: a round. R1 moves on beats 1 and 2 and holds 3 and 4; R2 does the
// opposite, so whichever instrument has which line, they interlock.
const R1 = 'B5:1 G5:0.5 A5:0.5 B5:2 | A5:1 F#5:0.5 G5:0.5 A5:2 | G5:1 C5:0.5 E5:0.5 G5:2 | F#5:1 D#5:0.5 E5:0.5 F#5:2';
const R2 = 'E5:2 G5:1 F#5:1 | D5:2 F#5:1 E5:1 | C5:2 E5:1 D5:1 | B4:2 D#5:1 F#5:1';
const PHASE_2_FLUTE: ScoreEvent[] = [...bars(R1, 84), ...bars(R2, 88), ...bars(R1, 92), ...bars(R2, 96)];
const PHASE_2_VIOLIN: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...transpose(bars(R1, 84), -12),
  ...transpose(bars(R2, 90), -12),
  ...transpose(bars(R1, 96), -12),
];

// Build: a one-bar relay climbing to the dominant.
const BUILD_VIOLIN: ScoreEvent[] = [
  ...bars('C5:1 E5:1 G5:2 | r:4', 88),
  ...bars('E5:1 G5:1 B5:2 | r:4', 96),
  ...bars('G5:1 C6:1 E6:2 | r:4', 104),
  ...bars('D#6:1 B5:1 F#5:1 B5:1 | F#5:2 A5:2', 112),
];
const BUILD_FLUTE: ScoreEvent[] = [
  ...bars('r:4 | D5:1 F#5:1 A5:2', 88),
  ...bars('r:4 | B5:1 G5:1 E5:2', 96),
  ...bars('r:4 | F#5:1 A5:1 C6:2', 104),
  ...bars('B5:1 F#5:1 D#5:1 F#5:1 | D#5:2 F#5:2', 112),
];

// Outro: the theme's tail, tresillo hits on the dominant, then on the tonic.
const OUTRO_VIOLIN: ScoreEvent[] = bars(
  'C6:1.5 B5:0.5 G5:1 E5:1 | D6:1.5 A5:1.5 F#5:1 | F#5:1 B5:1 D#6:2 | B5:1.5 B5:1.5 D#6:1 | E6:1.5 B5:1.5 G5:1 | G5:1.5 B5:1.5 E6:1 | E6:1.5 E6:1.5 E6:1 | E6:1 r:3',
  116,
);
const OUTRO_FLUTE: ScoreEvent[] = bars(
  'G5:4 | D5:4 | D#5:1 F#5:1 B5:2 | F#5:1.5 F#5:1.5 A5:1 | B5:1.5 G5:1.5 E5:1 | E5:1.5 G5:1.5 B5:1 | B5:1.5 B5:1.5 B5:1 | B5:1 r:3',
  110,
);

const VIOLIN: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...bars('B4:4', 60), ...bars('E5:4', 72), ...bars('D#5:4', 84), ...bars('F#5:4', 96),
  ...A_VIOLIN(104),
  ...B_VIOLIN,
  ...PHASE_2_VIOLIN,
  ...BUILD_VIOLIN,
  ...A_VIOLIN(116),
  ...OUTRO_VIOLIN,
];

const FLUTE: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4'),
  ...A_FLUTE,
  ...B_FLUTE,
  ...PHASE_2_FLUTE,
  ...BUILD_FLUTE,
  ...A2_FLUTE,
  ...OUTRO_FLUTE,
];

// ---------- piano: the engine ----------

/** Root, fifth and the third above, voiced around middle C. */
const TRIAD: Record<string, readonly [string, string, string]> = {
  Em: ['E4', 'B4', 'G5'],
  C: ['C4', 'G4', 'E5'],
  D: ['D4', 'A4', 'F#5'],
  B: ['B3', 'F#4', 'D#5'],
  G: ['G3', 'D4', 'B4'],
  Am: ['A3', 'E4', 'C5'],
};

const triad = (c: Chord): readonly [string, string, string] => {
  const t = TRIAD[c.symbol.replace('7', '')];
  if (!t) throw new Error(`no piano voicing for ${c.symbol}`);
  return t;
};

/** Straight eighths grouped 3+3+2: the accents fall against the beat. */
const engine = (c: Chord): string => {
  const [r, f, t] = triad(c);
  return [r, f, t, r, f, t, r, f].map((n) => `${n}:0.5`).join(' ');
};

/** Off-beat pumps: silence on every beat, a chord tone on every "and". */
const pump = (c: Chord): string => {
  const [r, f, t] = triad(c);
  return `r:0.5 ${r}:0.5 r:0.5 ${f}:0.5 r:0.5 ${t}:0.5 r:0.5 ${f}:0.5`;
};

/** Quarter-note arpeggio an octave down: root, fifth, octave, fifth. */
const lowArp = (c: Chord): string => {
  const root = toneAbove(c.root, 47);
  return [root, root + 7, root + 12, root + 7].map((m) => `${nameOf(m)}:1`).join(' ');
};

const PIANO: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4'),
  ...follow(INTRO.slice(4), engine, 80),
  ...follow(A, engine, 88),
  ...follow(B, pump, 84),
  ...follow(PHASE_2, lowArp, 72),
  ...follow(BUILD, engine, 92),
  ...follow(A, engine, 96),
  ...follow(OUTRO.slice(0, 4), engine, 100),
  ...bars('E3:1.5 G3:1.5 B3:1 | E3:1.5 G3:1.5 B3:1 | E3:1.5 G3:1.5 B3:1 | E2:1 r:3', 112),
];

// ---------- cello: the heartbeat ----------

/** The chord's bass in the cello's low octave (B1 to Bb2). */
const low = (c: Chord): number => toneAbove(c.bass, 35);

/** Dotted quarter, dotted quarter, quarter: root, root, fifth. */
const tresillo = (c: Chord): string => {
  const r = low(c);
  return `${nameOf(r)}:1.5 ${nameOf(r)}:1.5 ${nameOf(r + 7)}:1`;
};

/** Root and its octave in quarters: the Build's rising pressure. */
const octaves = (c: Chord): string => {
  const r = nameOf(low(c));
  const o = nameOf(low(c) + 12);
  return `${r}:1 ${o}:1 ${r}:1 ${o}:1`;
};

const CELLO: ScoreEvent[] = [
  ...follow([...INTRO, ...A, ...B, ...PHASE_2], tresillo, 100),
  ...follow(BUILD, octaves, 104),
  ...withVelocity(follow([...A, ...OUTRO.slice(0, 7)], tresillo), 110),
  ...bars('E2:1 r:3', 120),
];


// ---------- drums ----------
// One line of hits on the kit (General MIDI keys): C2 kick, D2 snare, F#2
// closed hat, A#2 open hat, C#3 crash, A2 and F2 toms. Eighths at most, so a
// phone can keep up at 150 bpm.
const ROCK = 'C2:0.5 F#2:0.5 D2:0.5 F#2:0.5 C2:0.5 C2:0.5 D2:0.5 F#2:0.5';
const ROCK_OPEN = 'C2:0.5 A#2:0.5 D2:0.5 F#2:0.5 C2:0.5 C2:0.5 D2:0.5 A#2:0.5';
const HALF = 'C2:1 F#2:1 D2:1.5 F#2:0.5';
const FILL = 'D2:0.5 D2:0.5 A2:0.5 A2:0.5 F2:0.5 F2:0.5 C2:1';
const CRASH = 'C#3:0.5 F#2:0.5 D2:0.5 F#2:0.5 C2:0.5 C2:0.5 D2:0.5 F#2:0.5';
const SNARES = 'D2:0.5 D2:0.5 D2:0.5 D2:0.5 D2:0.5 D2:0.5 D2:0.5 D2:0.5';
const times = (n: number, bar: string): string[] => Array.from({ length: n }, () => bar);
const phrase = (bar: string): string => [...times(7, bar), FILL].join(' | ');

const DRUMS: ScoreEvent[] = [
  // Intro: the heartbeat with the cello, then hats creep in.
  ...bars([...times(4, 'C2:1 r:1 C2:1 r:1'), ...times(3, 'C2:1 F#2:1 C2:1 F#2:1'), FILL].join(' | '), 92),
  // A: the rock beat under the theme.
  ...bars([CRASH, ...times(6, ROCK), FILL, CRASH, ...times(6, ROCK), FILL].join(' | '), 100),
  // B: open hats lift the relative major.
  ...bars([phrase(ROCK_OPEN), phrase(ROCK_OPEN)].join(' | '), 102),
  // Phase 2: half time over the ground.
  ...bars([phrase(HALF), phrase(HALF)].join(' | '), 96),
  // Build: eighth-note snares, getting louder.
  ...bars(times(4, SNARES).join(' | '), 100),
  ...bars(times(4, SNARES).join(' | '), 116),
  // A': full force, crash on every four.
  ...bars([CRASH, ROCK, ROCK, ROCK, CRASH, ROCK, ROCK, FILL, CRASH, ROCK, ROCK, ROCK, CRASH, ROCK, ROCK, FILL].join(' | '), 112),
  // Outro: the beat, the tresillo hits, one last crash.
  ...bars([ROCK, ROCK, ROCK, FILL, 'C2:1.5 C2:1.5 D2:1', 'C2:1.5 C2:1.5 D2:1', 'C#3:1 r:3', 'r:4'].join(' | '), 118),
];

export const bossRush: Score = {
  id: 'boss-rush',
  title: 'Boss Rush',
  composer: 'Kilukkam Originals',
  bpm: 150,
  beatsPerBar: 4,
  tracks: [
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 20, events: VIOLIN },
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 20, events: FLUTE },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 20, events: PIANO },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 20, events: CELLO },
    { id: 'drums', name: 'Drums', instrument: 'drums', maxPlayers: 20, events: DRUMS },
  ],
};
