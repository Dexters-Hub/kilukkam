import { note, offsetTrack, type Score, type ScoreEvent, type Track } from '../score.js';

// Pachelbel: Canon in D. The three violin parts are the same melody
// entering 2 bars apart; the cello loops the 8-note ground bass.

// Phrase A: the famous opening, half notes (8 bars, 32 beats)
const PHRASE_A: ScoreEvent[] = [
  note(78, 2), note(76, 2), note(74, 2), note(73, 2), // F#5 E5 D5 C#5
  note(71, 2), note(69, 2), note(71, 2), note(73, 2), // B4 A4 B4 C#5
  note(74, 2), note(73, 2), note(71, 2), note(69, 2), // D5 C#5 B4 A4
  note(67, 2), note(66, 2), note(67, 2), note(64, 2), // G4 F#4 G4 E4
];

// Phrase B: quarter-note variation over the same ground bass (8 bars, 32 beats)
const PHRASE_B: ScoreEvent[] = [
  note(66, 1), note(69, 1), note(74, 1), note(69, 1), // D  : F#4 A4 D5 A4
  note(64, 1), note(69, 1), note(73, 1), note(76, 1), // A  : E4 A4 C#5 E5
  note(66, 1), note(71, 1), note(74, 1), note(78, 1), // Bm : F#4 B4 D5 F#5
  note(73, 1), note(69, 1), note(78, 1), note(69, 1), // F#m: C#5 A4 F#5 A4
  note(67, 1), note(71, 1), note(74, 1), note(79, 1), // G  : G4 B4 D5 G5
  note(78, 1), note(74, 1), note(69, 1), note(66, 1), // D  : F#5 D5 A4 F#4
  note(79, 1), note(74, 1), note(71, 1), note(67, 1), // G  : G5 D5 B4 G4
  note(76, 1), note(73, 1), note(69, 1), note(64, 1), // A  : E5 C#5 A4 E4
];

const MELODY: ScoreEvent[] = [...PHRASE_A, ...PHRASE_B, ...PHRASE_A];

// Ground bass: D A B F# G D G A, half notes, 16 beats per cycle
const BASS_CYCLE: ScoreEvent[] = [
  note(50, 2), note(45, 2), note(47, 2), note(42, 2),
  note(43, 2), note(50, 2), note(43, 2), note(45, 2),
];

const MELODY_BARS = 24; // 96 beats
const BASS_CYCLES = MELODY_BARS / 4;
const CELLO_EVENTS: ScoreEvent[] = Array.from(
  { length: BASS_CYCLES },
  () => BASS_CYCLE.map((e) => ({ ...e })),
).flat();

const violin1: Track = {
  id: 'violin-1',
  name: 'Violin I',
  instrument: 'violin',
  maxPlayers: 30,
  events: MELODY,
};

export const canonInD: Score = {
  id: 'canon-in-d',
  title: 'Canon in D',
  composer: 'Johann Pachelbel',
  bpm: 72,
  beatsPerBar: 4,
  tracks: [
    violin1,
    offsetTrack(violin1, 'violin-2', 'Violin II', 8), // enters bar 3
    offsetTrack(violin1, 'violin-3', 'Violin III', 16), // enters bar 5
    {
      id: 'cello',
      name: 'Cello',
      instrument: 'cello',
      maxPlayers: 10,
      events: CELLO_EVENTS,
    },
  ],
};
