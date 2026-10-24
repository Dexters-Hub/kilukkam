// Thaalam phrase bank: the first five notes of real, recognisable songs.
// Only the melodic incipit is stored. Phrases marked `unverified` are
// best-effort transcriptions that still need checking by ear; they stay
// out of DAILY_POOL until someone does.

export type Genre = 'classical' | 'film' | 'folk' | 'rahman' | 'pop';

export const GENRES: readonly Genre[] = ['classical', 'film', 'folk', 'rahman', 'pop'];

export const PHRASE_LEN = 5;
export const MIN_PHRASE_MIDI = 48; // C3
export const MAX_PHRASE_MIDI = 84; // C6

export interface Phrase {
  id: string;
  song: string;
  /** Composer or music director; pop songs may give an artist instead */
  composer?: string;
  artist?: string;
  genre: Genre;
  key: string;
  /** Period or decade, revealed by the era hint */
  era: string;
  midi: readonly number[];
  /** Transcription not yet checked by ear */
  unverified?: true;
}

export const PHRASES: readonly Phrase[] = [
  // Classical
  { id: 'ode-to-joy', song: 'Ode to Joy (Symphony No. 9)', composer: 'Ludwig van Beethoven', genre: 'classical', key: 'D major', era: 'Romantic', midi: [66, 66, 67, 69, 69] },
  { id: 'fur-elise', song: 'Fur Elise', composer: 'Ludwig van Beethoven', genre: 'classical', key: 'A minor', era: 'Classical', midi: [76, 75, 76, 75, 76] },
  { id: 'canon-in-d', song: 'Canon in D', composer: 'Johann Pachelbel', genre: 'classical', key: 'D major', era: 'Baroque', midi: [78, 76, 74, 73, 71] },
  { id: 'eine-kleine-nachtmusik', song: 'Eine kleine Nachtmusik', composer: 'Wolfgang Amadeus Mozart', genre: 'classical', key: 'G major', era: 'Classical', midi: [67, 62, 67, 62, 67] },
  { id: 'swan-lake', song: 'Swan Lake (Scene)', composer: 'Pyotr Ilyich Tchaikovsky', genre: 'classical', key: 'B minor', era: 'Romantic', midi: [78, 71, 73, 74, 76] },
  { id: 'beethoven-5', song: 'Symphony No. 5', composer: 'Ludwig van Beethoven', genre: 'classical', key: 'C minor', era: 'Classical', midi: [67, 67, 67, 63, 65] },
  { id: 'mozart-40', song: 'Symphony No. 40', composer: 'Wolfgang Amadeus Mozart', genre: 'classical', key: 'G minor', era: 'Classical', midi: [75, 74, 74, 75, 74] },
  { id: 'mountain-king', song: 'In the Hall of the Mountain King', composer: 'Edvard Grieg', genre: 'classical', key: 'B minor', era: 'Romantic', midi: [59, 61, 62, 64, 66] },
  { id: 'toccata-and-fugue', song: 'Toccata and Fugue in D minor', composer: 'Johann Sebastian Bach', genre: 'classical', key: 'D minor', era: 'Baroque', midi: [81, 79, 81, 79, 77] },
  { id: 'spring', song: 'Spring (The Four Seasons)', composer: 'Antonio Vivaldi', genre: 'classical', key: 'E major', era: 'Baroque', midi: [76, 80, 80, 80, 78] },
  { id: 'rondo-alla-turca', song: 'Rondo alla Turca', composer: 'Wolfgang Amadeus Mozart', genre: 'classical', key: 'A minor', era: 'Classical', midi: [71, 69, 68, 69, 72] },
  { id: 'morning-mood', song: 'Morning Mood (Peer Gynt)', composer: 'Edvard Grieg', genre: 'classical', key: 'E major', era: 'Romantic', midi: [71, 68, 66, 64, 66] },

  // A. R. Rahman
  { id: 'jai-ho', song: 'Jai Ho (Slumdog Millionaire)', composer: 'A. R. Rahman', genre: 'rahman', key: 'A minor', era: '2000s', midi: [72, 72, 74, 72, 69], unverified: true },
  { id: 'chaiyya-chaiyya', song: 'Chaiyya Chaiyya (Dil Se..)', composer: 'A. R. Rahman', genre: 'rahman', key: 'F major', era: '1990s', midi: [60, 65, 65, 64, 65], unverified: true },
  { id: 'tu-hi-re', song: 'Tu Hi Re (Bombay)', composer: 'A. R. Rahman', genre: 'rahman', key: 'A minor', era: '1990s', midi: [69, 71, 72, 74, 72], unverified: true },
  { id: 'maa-tujhe-salaam', song: 'Maa Tujhe Salaam (Vande Mataram)', composer: 'A. R. Rahman', genre: 'rahman', key: 'D minor', era: '1990s', midi: [62, 65, 67, 69, 67], unverified: true },
  { id: 'kun-faya-kun', song: 'Kun Faya Kun (Rockstar)', composer: 'A. R. Rahman', genre: 'rahman', key: 'E minor', era: '2010s', midi: [64, 67, 69, 67, 64], unverified: true },
  { id: 'kadhal-rojave', song: 'Kadhal Rojave (Roja)', composer: 'A. R. Rahman', genre: 'rahman', key: 'A minor', era: '1990s', midi: [64, 62, 60, 62, 57], unverified: true },

  // Indian film
  { id: 'tujhe-dekha-to', song: 'Tujhe Dekha To (Dilwale Dulhania Le Jayenge)', composer: 'Jatin-Lalit', genre: 'film', key: 'C major', era: '1990s', midi: [64, 64, 62, 64, 65], unverified: true },
  { id: 'kuch-kuch-hota-hai', song: 'Kuch Kuch Hota Hai', composer: 'Jatin-Lalit', genre: 'film', key: 'C major', era: '1990s', midi: [67, 67, 69, 67, 64], unverified: true },
  { id: 'kilukil-pambaram', song: 'Kilukil Pambaram (Kilukkam)', composer: 'S. P. Venkatesh', genre: 'film', key: 'C major', era: '1990s', midi: [72, 71, 69, 71, 72], unverified: true },
  { id: 'tum-hi-ho', song: 'Tum Hi Ho (Aashiqui 2)', composer: 'Mithoon', genre: 'film', key: 'A minor', era: '2010s', midi: [69, 69, 71, 72, 71], unverified: true },

  // Folk and nursery
  { id: 'twinkle-twinkle', song: 'Twinkle, Twinkle, Little Star', composer: 'Traditional', genre: 'folk', key: 'C major', era: 'Traditional', midi: [60, 60, 67, 67, 69] },
  { id: 'happy-birthday', song: 'Happy Birthday to You', composer: 'Mildred and Patty Hill', genre: 'folk', key: 'C major', era: '1890s', midi: [67, 67, 69, 67, 72] },
  { id: 'frere-jacques', song: 'Frere Jacques', composer: 'Traditional', genre: 'folk', key: 'C major', era: 'Traditional', midi: [60, 62, 64, 60, 60] },
  { id: 'mary-had-a-little-lamb', song: 'Mary Had a Little Lamb', composer: 'Traditional', genre: 'folk', key: 'C major', era: 'Traditional', midi: [64, 62, 60, 62, 64] },
  { id: 'london-bridge', song: 'London Bridge Is Falling Down', composer: 'Traditional', genre: 'folk', key: 'C major', era: 'Traditional', midi: [67, 69, 67, 65, 64] },
  { id: 'old-macdonald', song: 'Old MacDonald Had a Farm', composer: 'Traditional', genre: 'folk', key: 'C major', era: 'Traditional', midi: [67, 67, 67, 62, 64] },
  { id: 'greensleeves', song: 'Greensleeves', composer: 'Traditional', genre: 'folk', key: 'A minor', era: 'Renaissance', midi: [69, 72, 74, 76, 77] },
  { id: 'amazing-grace', song: 'Amazing Grace', composer: 'Traditional', genre: 'folk', key: 'G major', era: '1830s', midi: [62, 67, 71, 67, 71] },

  // Pop and global
  { id: 'seven-nation-army', song: 'Seven Nation Army', artist: 'The White Stripes', genre: 'pop', key: 'E minor', era: '2000s', midi: [64, 64, 67, 64, 62] },
  { id: 'smoke-on-the-water', song: 'Smoke on the Water', artist: 'Deep Purple', genre: 'pop', key: 'G minor', era: '1970s', midi: [67, 70, 72, 67, 70] },
  { id: 'billie-jean', song: 'Billie Jean', artist: 'Michael Jackson', genre: 'pop', key: 'F# minor', era: '1980s', midi: [54, 49, 52, 54, 52] },
  { id: 'take-on-me', song: 'Take On Me', artist: 'a-ha', genre: 'pop', key: 'A major', era: '1980s', midi: [78, 78, 74, 71, 71] },
  { id: 'sweet-child-o-mine', song: "Sweet Child O' Mine", artist: "Guns N' Roses", genre: 'pop', key: 'D major', era: '1980s', midi: [62, 74, 69, 67, 79] },
  { id: 'hey-jude', song: 'Hey Jude', artist: 'The Beatles', genre: 'pop', key: 'F major', era: '1960s', midi: [72, 69, 69, 72, 74] },
  { id: 'yesterday', song: 'Yesterday', artist: 'The Beatles', genre: 'pop', key: 'F major', era: '1960s', midi: [67, 65, 65, 69, 71] },
  { id: 'axel-f', song: 'Axel F', artist: 'Harold Faltermeyer', genre: 'pop', key: 'F minor', era: '1980s', midi: [65, 68, 65, 65, 70] },
  { id: 'let-it-be', song: 'Let It Be', artist: 'The Beatles', genre: 'pop', key: 'C major', era: '1970s', midi: [67, 67, 67, 69, 64], unverified: true },
  { id: 'imagine', song: 'Imagine', artist: 'John Lennon', genre: 'pop', key: 'C major', era: '1970s', midi: [64, 64, 67, 67, 69], unverified: true },
];

/** Phrases safe to serve as the world's daily puzzle */
export const DAILY_POOL: readonly Phrase[] = PHRASES.filter((p) => !p.unverified);

export function getPhrase(id: string): Phrase | undefined {
  return PHRASES.find((p) => p.id === id);
}

export function phrasesByGenre(): Record<Genre, Phrase[]> {
  const out: Record<Genre, Phrase[]> = { classical: [], film: [], folk: [], rahman: [], pop: [] };
  for (const p of PHRASES) out[p.genre].push(p);
  return out;
}

export function validatePhrase(p: Phrase): string[] {
  const errors: string[] = [];
  const at = `phrase ${p.id}`;
  if (!p.id) errors.push('phrase has no id');
  if (!p.song) errors.push(`${at}: has no song`);
  if (!p.composer && !p.artist) errors.push(`${at}: needs a composer or an artist`);
  if (!GENRES.includes(p.genre)) errors.push(`${at}: unknown genre ${String(p.genre)}`);
  if (!p.key) errors.push(`${at}: has no key`);
  if (!p.era) errors.push(`${at}: has no era`);
  if (p.midi.length !== PHRASE_LEN) {
    errors.push(`${at}: needs ${PHRASE_LEN} notes, has ${p.midi.length}`);
  }
  p.midi.forEach((m, i) => {
    if (!Number.isInteger(m) || m < MIN_PHRASE_MIDI || m > MAX_PHRASE_MIDI) {
      errors.push(`${at} note ${i}: midi ${m} out of range`);
    }
  });
  if (new Set(p.midi).size < 2) errors.push(`${at}: needs at least two distinct notes`);
  return errors;
}
