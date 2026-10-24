import { type InstrumentId, MAX_BPM, MAX_PLAYERS, MIN_BPM, type Score, type ScoreEvent, type Track, note, rest } from '@kilukkam/shared';
import { BANK_NOTES } from '../samples.js';

// Design note: a play-along score for any Spotify song.
//
// The song plays from Spotify on the conductor laptop; the room plays along
// on top of it. We know only what the microphone or tap tempo found (bpm),
// the meter the conductor picked (beatsPerBar), how long to play (bars), and
// optionally a key the conductor chose by ear: Spotify no longer gives
// tempo or key to new apps. So the score is built from rules, not
// transcribed:
//
// - Drums, always: a kick on the odd beats and a snare on the even beats
//   (beats 1 and 3, 2 and 4 in 4/4), with a hat on every off beat eighth.
//   Each part is one phone tap per note, so it must be monophonic: where a
//   kick or snare and a hat coincide, the drum wins and the hat takes the
//   off beat. In odd meters the bar ends on a snare (3/4 is kick snare snare).
// - Claps and shaker, always: a clap on each backbeat and a shaker pickup on
//   the last off beat of the bar. Sparse on purpose: the easy part for
//   anyone who just wants to join in.
// - With a key, a bass, a pad and a fingerstyle guitar on I V vi IV, one chord per bar (in minor
//   the same scale degrees: i v VI iv). The bass plays the chord root in half
//   notes. The pad holds one chord tone per bar, chosen as the tone nearest
//   the previous one, so the line moves by small steps like a real inner
//   voice instead of jumping between root positions.
//
// Every pitch stays inside the recorded range of its instrument
// (samples.ts BANK_NOTES), and the result passes the shared validateScore.

export type Mode = 'major' | 'minor';

export interface Key {
  /** Pitch class of the tonic: 0 = C, 1 = C sharp, ... 11 = B */
  tonic: number;
  mode: Mode;
}

export interface PlayAlongInput {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  key?: Key | null;
}

/** Score id of every play-along, so the conductor can tell it from a library piece or a MIDI import */
export const PLAYALONG_ID = 'play-along';

export const PLAYALONG_LIMITS = { minBeatsPerBar: 2, maxBeatsPerBar: 7, minBars: 1, maxBars: 256 } as const;

/** Lowest and highest recorded note of an instrument's main bank. */
export const rangeOf = (instrument: InstrumentId): { low: number; high: number } => {
  // The kit is synthesised: its range is the General MIDI drum keys it answers to.
  if (instrument === 'drums') return { low: 35, high: 57 };
  if (instrument === 'guitar') return { low: 40, high: 84 };
  const notes = BANK_NOTES[instrument];
  return { low: Math.min(...notes), high: Math.max(...notes) };
};

// Percussion on the drum kit (audio.ts synthesises it, keyed like General
// MIDI drums): kick 36, snare 38 and closed hat 42 for the drummers, clap 39
// and open hat 46 (the shaker pickup) for the claps part.
export const DRUM_VOICE = { instrument: 'drums', kick: 36, snare: 38, hat: 42 } as const satisfies { instrument: InstrumentId } & Record<'kick' | 'snare' | 'hat', number>;
export const CLAP_VOICE = { instrument: 'drums', clap: 39, shaker: 46 } as const satisfies { instrument: InstrumentId } & Record<'clap' | 'shaker', number>;

const BASS_INSTRUMENT: InstrumentId = 'cello';
const PAD_INSTRUMENT: InstrumentId = 'flute';
/** The pad keeps to the middle of the flute, where it sounds soft */
const PAD_WINDOW = { low: 62, high: 79, start: 67 } as const;

const SCALES: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** I V vi IV as scale degrees (0 based) */
const PROGRESSION = [0, 4, 5, 3] as const;

const pc = (n: number): number => ((n % 12) + 12) % 12;

/** Root, third and fifth (pitch classes) of the diatonic triad on `degree`. */
export const triad = (key: Key, degree: number): [number, number, number] => {
  const scale = SCALES[key.mode];
  const at = (i: number): number => pc(key.tonic + (scale[i % 7] ?? 0));
  return [at(degree), at(degree + 2), at(degree + 4)];
};

/** The chord for each bar, cycling I V vi IV. */
export const chordsFor = (key: Key, bars: number): [number, number, number][] =>
  Array.from({ length: bars }, (_, bar) => triad(key, PROGRESSION[bar % PROGRESSION.length] ?? 0));

/** Merge neighbouring rests so a part reads as phrases, not a stutter of tiny rests. */
const compact = (events: readonly ScoreEvent[]): ScoreEvent[] => {
  const out: ScoreEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (e.kind === 'rest' && prev?.kind === 'rest') out[out.length - 1] = rest(prev.beats + e.beats);
    else out.push(e);
  }
  return out;
};

/** Kick on the odd beats, snare on the even ones; an odd meter ends its bar on a snare. */
export const drumOnBeat = (beat: number, beatsPerBar: number): 'kick' | 'snare' => {
  if (beat === 0) return 'kick';
  if (beatsPerBar % 2 === 1 && beat === beatsPerBar - 1) return 'snare';
  return beat % 2 === 0 ? 'kick' : 'snare';
};

export const drumsPart = (beatsPerBar: number, bars: number): ScoreEvent[] => {
  const events: ScoreEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const hit = drumOnBeat(beat, beatsPerBar);
      events.push(note(DRUM_VOICE[hit], 0.5, hit === 'kick' ? 112 : 100), note(DRUM_VOICE.hat, 0.5, 64));
    }
  }
  return events;
};

export const clapsPart = (beatsPerBar: number, bars: number): ScoreEvent[] => {
  const events: ScoreEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const onBeat = drumOnBeat(beat, beatsPerBar) === 'snare' ? note(CLAP_VOICE.clap, 0.5, 100) : rest(0.5);
      const offBeat = beat === beatsPerBar - 1 ? note(CLAP_VOICE.shaker, 0.5, 72) : rest(0.5);
      events.push(onBeat, offBeat);
    }
  }
  return compact(events);
};

/** The lowest note of pitch class `p` at or above `low`. */
const lowestAtOrAbove = (p: number, low: number): number => low + pc(p - low);

export const bassPart = (key: Key, beatsPerBar: number, bars: number): ScoreEvent[] => {
  const { low } = rangeOf(BASS_INSTRUMENT);
  const events: ScoreEvent[] = [];
  for (const [root] of chordsFor(key, bars)) {
    const midi = lowestAtOrAbove(root, Math.max(low, 36));
    for (let left = beatsPerBar; left > 0; ) {
      const beats = left >= 2 ? 2 : left;
      events.push(note(midi, beats, left === beatsPerBar ? 100 : 84));
      left -= beats;
    }
  }
  return events;
};

/**
 * Fingerstyle guitar: each bar's chord as a rolling pattern, the thumb on
 * the root and the fingers on the fifth and the tenth (root, 5th, 10th,
 * 5th...). Eighth notes, or quarters above 140 bpm so every note stays a
 * comfortable tap.
 */
export const guitarPart = (key: Key, beatsPerBar: number, bars: number, bpm: number): ScoreEvent[] => {
  const step = bpm > 140 ? 1 : 0.5;
  const events: ScoreEvent[] = [];
  for (const [root, third, fifth] of chordsFor(key, bars)) {
    const r = lowestAtOrAbove(root, 40);
    const pattern = [r, lowestAtOrAbove(fifth, r + 1), lowestAtOrAbove(third, r + 12), lowestAtOrAbove(fifth, r + 1)];
    for (let i = 0; i < beatsPerBar / step; i++) events.push(note(pattern[i % pattern.length] ?? r, step, i === 0 ? 96 : 76));
  }
  return events;
};

/** Every note of these pitch classes inside [low, high]. */
const candidates = (pcs: readonly number[], low: number, high: number): number[] => {
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(pc(m))) out.push(m);
  return out;
};

/** The candidate nearest `from`; ties go to the lower note. */
const nearest = (options: readonly number[], from: number): number =>
  options.reduce((best, m) => (Math.abs(m - from) < Math.abs(best - from) || (Math.abs(m - from) === Math.abs(best - from) && m < best) ? m : best));

export const padPart = (key: Key, beatsPerBar: number, bars: number): ScoreEvent[] => {
  const events: ScoreEvent[] = [];
  let prev: number = PAD_WINDOW.start;
  chordsFor(key, bars).forEach((chord, bar) => {
    // The first bar starts on the third, the most colourful tone; after that, smallest move wins.
    const pool = candidates(bar === 0 ? [chord[1]] : chord, PAD_WINDOW.low, PAD_WINDOW.high);
    const midi = nearest(pool, prev);
    events.push(note(midi, beatsPerBar, 70));
    prev = midi;
  });
  return events;
};

const isInt = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;

/** Everything wrong with the input, empty when it can be built. */
export const playAlongErrors = (input: PlayAlongInput): string[] => {
  const errors: string[] = [];
  const L = PLAYALONG_LIMITS;
  if (!(Number.isFinite(input.bpm) && input.bpm >= MIN_BPM && input.bpm <= MAX_BPM)) errors.push(`bpm must be between ${MIN_BPM} and ${MAX_BPM}`);
  if (!isInt(input.beatsPerBar, L.minBeatsPerBar, L.maxBeatsPerBar)) errors.push(`beatsPerBar must be a whole number from ${L.minBeatsPerBar} to ${L.maxBeatsPerBar}`);
  if (!isInt(input.bars, L.minBars, L.maxBars)) errors.push(`bars must be a whole number from ${L.minBars} to ${L.maxBars}`);
  const key = input.key;
  if (key) {
    if (!isInt(key.tonic, 0, 11)) errors.push('key tonic must be a pitch class from 0 to 11');
    if (key.mode !== 'major' && key.mode !== 'minor') errors.push('key mode must be major or minor');
  }
  return errors;
};

const track = (id: string, name: string, instrument: InstrumentId, maxPlayers: number, events: ScoreEvent[]): Track => ({
  id,
  name,
  instrument,
  maxPlayers,
  events,
});

/** Build the play-along score. Throws RangeError listing every problem when the input is out of range. */
export const buildPlayAlong = (input: PlayAlongInput): Score => {
  const errors = playAlongErrors(input);
  if (errors.length) throw new RangeError(errors.join('; '));
  const { bpm, beatsPerBar, bars } = input;
  const key = input.key ?? null;
  // Seats split evenly across the parts, so a full room always fits.
  const seats = Math.floor(MAX_PLAYERS / (key ? 5 : 2));
  const tracks: Track[] = [
    track('drums', 'Drums', DRUM_VOICE.instrument, seats, drumsPart(beatsPerBar, bars)),
    track('claps', 'Claps', CLAP_VOICE.instrument, seats, clapsPart(beatsPerBar, bars)),
  ];
  if (key) {
    tracks.push(
      track('bass', 'Bass', BASS_INSTRUMENT, seats, bassPart(key, beatsPerBar, bars)),
      track('pad', 'Pad', PAD_INSTRUMENT, seats, padPart(key, beatsPerBar, bars)),
      track('guitar', 'Guitar', 'guitar', seats, guitarPart(key, beatsPerBar, bars, bpm)),
    );
  }
  return { id: PLAYALONG_ID, title: 'Play along', composer: 'Kilukkam', bpm, beatsPerBar, tracks };
};
