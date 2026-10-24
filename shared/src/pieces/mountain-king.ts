import type { Score, ScoreEvent } from '../score.js';
import { fingerpick, type Picking, type Shapes } from './fingerstyle.js';
import { bars, follow, transpose, withVelocity, type Chord } from './originals/notation.js';

/*
 * In the Hall of the Mountain King, Edvard Grieg (Peer Gynt, 1875). Public
 * domain; this arrangement is written fresh for Kilukkam.
 *
 * B minor, 4/4, 132 bpm, 50 bars, about 91 seconds. One tempo, so the famous
 * accelerando is written into the note values instead:
 *
 *   Creep   bars 1 to 16   the first half of the theme in quarter notes:
 *                          the cello alone, the violin joins at bar 9
 *   March   bars 17 to 32  the whole theme in eighths, twice the notes
 *   Frenzy  bars 33 to 48  the theme again, the violin an octave up, piano
 *                          stabs on every beat, the drums at full tilt
 *   Crash   bars 49 and 50 dominant stabs, then the last B minor hit
 *
 * The theme (16 bars): A A M A, where A is the rising B minor phrase and M
 * the same shape on the dominant, F sharp.
 *
 * Violin  the theme; Cello the theme an octave below; Guitar broken chords
 * low on the neck; Piano short stabs; Drums kick, snare and hat.
 *
 * Harmony plan (one chord per bar; "C# C" splits the bar):
 *   A  | Bm | C# C  | Bm | D     |   the chromatic slide F#, E#, E under the theme
 *   M  | F# | Bb F# | F# | Bb F# |   Bb spells the D and A# of the theme
 *   Creep: A A at half speed, each half bar becoming a whole bar.
 *   Crash: | F# | Bm |
 */

const A_PLAN = ['Bm', 'C# C', 'Bm', 'D'];
const M_PLAN = ['F#', 'Bb F#', 'F#', 'Bb F#'];
const THEME_PLAN = [...A_PLAN, ...A_PLAN, ...M_PLAN, ...A_PLAN];

/** Each half of a bar at half speed fills a whole bar. */
const slow = (plan: readonly string[]): string[] =>
  plan.flatMap((bar) => {
    const s = bar.trim().split(/\s+/);
    return s.length === 1 ? [bar, bar] : s;
  });

const CREEP_PLAN = slow([...A_PLAN, ...A_PLAN]);
const CRASH_PLAN = ['F#', 'Bm'];

export const mountainKingHarmony: readonly string[] = [...CREEP_PLAN, ...THEME_PLAN, ...THEME_PLAN, ...CRASH_PLAN];

// ---------- the theme, at the violin's pitch ----------

const A = [
  'B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:1',
  'E#4:0.5 C#4:0.5 E#4:1 E4:0.5 C4:0.5 E4:1',
  'B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:0.5 B4:0.5',
  'A4:0.5 F#4:0.5 D4:0.5 F#4:0.5 A4:2',
].join(' | ');
const M = [
  'F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:1',
  'D5:0.5 A#4:0.5 D5:1 C#5:0.5 A#4:0.5 C#5:1',
  'F#4:0.5 G#4:0.5 A#4:0.5 B4:0.5 C#5:0.5 A#4:0.5 C#5:1',
  'D5:0.5 A#4:0.5 D5:1 C#5:2',
].join(' | ');

const THEME = bars([A, A, M, A].join(' | '));
/** The first half (A A) at half speed: every note twice as long. */
const CREEP = bars([A, A].join(' | ')).map((e) => ({ ...e, beats: e.beats * 2 }));

const VIOLIN: ScoreEvent[] = [
  ...bars('r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4'),
  ...withVelocity(CREEP.slice(CREEP.length / 2), 70),
  ...withVelocity(THEME, 88),
  ...transpose(withVelocity(THEME, 104), 12),
  ...bars('F#5:1 r:1 C#6:1 r:1 | B5:1 r:3', 112),
];

const CELLO: ScoreEvent[] = [
  ...transpose(withVelocity(CREEP, 66), -12),
  ...transpose(withVelocity(THEME, 90), -12),
  ...transpose(withVelocity(THEME, 104), -12),
  ...bars('F#2:1 r:1 F#2:1 r:1 | B1:1 r:3', 112),
];

// ---------- guitar: low broken chords ----------

const SHAPES: Shapes = {
  Bm: ['B2', 'F#3', 'B3', 'D4'],
  'C#': ['C#3', 'G#3', 'C#4', 'E#4'],
  C: ['C3', 'G3', 'C4', 'E4'],
  D: ['D3', 'A3', 'D4', 'F#4'],
  'F#': ['F#2', 'C#3', 'F#3', 'A#3'],
  Bb: ['Bb2', 'F3', 'Bb3', 'D4'],
};

const CREEP_PICK: Picking = { order: [0, 1, 2, 1], step: 1, velocity: 58, bassVelocity: 70 };
const MARCH_PICK: Picking = { order: [0, 1, 2, 1, 3, 1, 2, 1], step: 0.5, velocity: 72, bassVelocity: 86 };
const FRENZY_PICK: Picking = { order: [0, 2, 1, 3, 0, 2, 1, 3], step: 0.5, velocity: 90, bassVelocity: 104 };

const GUITAR: ScoreEvent[] = [
  ...fingerpick(CREEP_PLAN, SHAPES, CREEP_PICK, 4),
  ...fingerpick(THEME_PLAN, SHAPES, MARCH_PICK, 4),
  ...fingerpick(THEME_PLAN, SHAPES, FRENZY_PICK, 4),
  ...bars('F#2:1 r:1 C#3:1 r:1 | B2:1 r:3', 112),
];

// ---------- piano: stabs ----------

/** Two chord tones for the stabs, struck in turn. */
const STAB: Readonly<Record<string, readonly [string, string]>> = {
  Bm: ['D5', 'F#4'],
  'C#': ['G#4', 'E#4'],
  C: ['G4', 'E4'],
  D: ['F#4', 'A4'],
  'F#': ['A#4', 'C#5'],
  Bb: ['D5', 'Bb4'],
};

const stab = (c: Chord): readonly [string, string] => {
  const s = STAB[c.symbol];
  if (!s) throw new Error(`no stab for ${c.symbol}`);
  return s;
};

const PIANO: ScoreEvent[] = [
  ...follow(CREEP_PLAN, (c) => `r:1 ${stab(c)[0]}:1 r:1 ${stab(c)[1]}:1`, 58),
  ...follow(THEME_PLAN, (c, beats) => (beats === 4 ? `${stab(c)[0]}:1 r:1 ${stab(c)[1]}:1 r:1` : `${stab(c)[0]}:1 r:1`), 80),
  ...follow(THEME_PLAN, (c, beats) => `${stab(c)[0]}:0.5 r:0.5 ${stab(c)[1]}:0.5 r:0.5 `.repeat(beats / 2), 100),
  ...bars('A#4:1 r:1 C#5:1 r:1 | B4:1 r:3', 112),
];

// ---------- drums (General MIDI: C2 kick, D2 snare, F#2 hat, C#3 crash, toms F2 A2 C3) ----------

const BEAT = 'C2:0.5 F#2:0.5 D2:0.5 F#2:0.5 C2:0.5 F#2:0.5 D2:0.5 F#2:0.5';
const CRASH_BEAT = 'C#3:0.5 F#2:0.5 D2:0.5 F#2:0.5 C2:0.5 F#2:0.5 D2:0.5 F#2:0.5';
const FILL = 'D2:0.5 D2:0.5 C3:0.5 C3:0.5 A2:0.5 A2:0.5 F2:0.5 F2:0.5';
const phrase = (first: string, last: string): string => [first, BEAT, BEAT, last].join(' | ');

const DRUMS: ScoreEvent[] = [
  ...bars(Array.from({ length: 16 }, () => 'C2:1 r:1 F#2:1 r:1').join(' | '), 60),
  ...bars([phrase(BEAT, BEAT), phrase(BEAT, BEAT), phrase(BEAT, BEAT), phrase(BEAT, FILL)].join(' | '), 82),
  ...bars([phrase(CRASH_BEAT, BEAT), phrase(CRASH_BEAT, BEAT), phrase(CRASH_BEAT, BEAT), phrase(CRASH_BEAT, FILL)].join(' | '), 100),
  ...bars('C#3:1 D2:1 C#3:1 D2:1 | C#3:1 r:3', 112),
];

export const mountainKing: Score = {
  id: 'mountain-king',
  title: 'In the Hall of the Mountain King',
  composer: 'Edvard Grieg',
  bpm: 132,
  beatsPerBar: 4,
  tracks: [
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 20, events: VIOLIN },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 20, events: CELLO },
    { id: 'guitar', name: 'Guitar', instrument: 'guitar', maxPlayers: 20, events: GUITAR },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 20, events: PIANO },
    { id: 'drums', name: 'Drums', instrument: 'drums', maxPlayers: 20, events: DRUMS },
  ],
};
