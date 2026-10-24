import { note, type Score, type ScoreEvent } from '../score.js';

// Beethoven: Ode to Joy, C major. Short and instantly recognisable;
// good first piece for a room that has never played together.

// Flute: melody
const MELODY: ScoreEvent[] = [
  note(64, 1), note(64, 1), note(65, 1), note(67, 1), // E E F G
  note(67, 1), note(65, 1), note(64, 1), note(62, 1), // G F E D
  note(60, 1), note(60, 1), note(62, 1), note(64, 1), // C C D E
  note(64, 1.5), note(62, 0.5), note(62, 2),          // E. D D-
  note(64, 1), note(64, 1), note(65, 1), note(67, 1),
  note(67, 1), note(65, 1), note(64, 1), note(62, 1),
  note(60, 1), note(60, 1), note(62, 1), note(64, 1),
  note(62, 1.5), note(60, 0.5), note(60, 2),          // D. C C-
];

// Violin: harmony a third below the melody
const HARMONY: ScoreEvent[] = [
  note(60, 1), note(60, 1), note(62, 1), note(64, 1), // C C D E
  note(64, 1), note(62, 1), note(60, 1), note(59, 1), // E D C B
  note(57, 1), note(57, 1), note(59, 1), note(60, 1), // A A B C
  note(60, 1.5), note(59, 0.5), note(59, 2),
  note(60, 1), note(60, 1), note(62, 1), note(64, 1),
  note(64, 1), note(62, 1), note(60, 1), note(59, 1),
  note(57, 1), note(57, 1), note(59, 1), note(60, 1),
  note(59, 1.5), note(57, 0.5), note(57, 2),
];

// Piano: light alberti-style pattern, chord tones
const PIANO: ScoreEvent[] = [
  note(60, 1), note(64, 1), note(67, 1), note(64, 1), // C
  note(55, 1), note(59, 1), note(62, 1), note(59, 1), // G
  note(60, 1), note(64, 1), note(67, 1), note(64, 1), // C
  note(60, 2), note(55, 2),                          // C G
  note(60, 1), note(64, 1), note(67, 1), note(64, 1),
  note(55, 1), note(59, 1), note(62, 1), note(59, 1),
  note(60, 1), note(64, 1), note(67, 1), note(64, 1),
  note(60, 4),                                       // C-
];

// Cello: roots, half notes
const BASS: ScoreEvent[] = [
  note(48, 2), note(52, 2), // C E
  note(43, 2), note(50, 2), // G D
  note(48, 2), note(52, 2),
  note(48, 2), note(43, 2),
  note(48, 2), note(52, 2),
  note(43, 2), note(50, 2),
  note(48, 2), note(52, 2),
  note(48, 4),              // C-
];

export const odeToJoy: Score = {
  id: 'ode-to-joy',
  title: 'Ode to Joy',
  composer: 'Ludwig van Beethoven',
  bpm: 100,
  beatsPerBar: 4,
  tracks: [
    { id: 'flute', name: 'Flute', instrument: 'flute', maxPlayers: 25, events: MELODY },
    { id: 'violin', name: 'Violin', instrument: 'violin', maxPlayers: 25, events: HARMONY },
    { id: 'piano', name: 'Piano', instrument: 'piano', maxPlayers: 25, events: PIANO },
    { id: 'cello', name: 'Cello', instrument: 'cello', maxPlayers: 25, events: BASS },
  ],
};
