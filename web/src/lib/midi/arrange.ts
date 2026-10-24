import { CUSTOM_PIECE_LIMITS, MAX_BPM, MAX_PLAYERS, MIN_BPM, validateScore, type InstrumentId, type Score, type Track } from '@kilukkam/shared';
import { BANK_NOTES } from '../samples.js';
import {
  absorbShortRests,
  bottomline,
  eventCount,
  fitRange,
  median,
  mergeRepeats,
  noteAt,
  skyline,
  thinToCells,
  toEvents,
  truncate,
  type Line,
  type Range,
  type StepNote,
} from './lines.js';
import type { ParsedSong, ParsedVoice } from './parse.js';
import { detectKey, pitchClass, type KeyInfo } from './theory.js';
import {
  chordMap,
  eighthSteps,
  generatedBass,
  leadVoice,
  parallelHarmony,
  realBass,
  rhythmLine,
  voiceTimes,
  type Grid,
} from './voices.js';

/*
 * Design note: arranging any MIDI file for a room of phones
 *
 * A phone plays one note per tap, so every part must be a single line, and a
 * section of strangers must be able to follow it. The arranger therefore
 * reduces the file to at most five roles, in priority order: melody, bass,
 * harmony 1, rhythm (only with drums), harmony 2.
 *
 * Melody. The voice whose top line is highest wins, nudged by its name
 * ("melody", "lead", "vocal", "right"...) and its General MIDI program (flutes,
 * reeds, violin, synth leads), and penalised when it looks like a bass or
 * only plays a few bars. Its skyline (highest note at each onset) is the
 * tune. Trade-off: a melody in an inner voice under a high descant is missed;
 * the name hints exist for exactly that case.
 *
 * Bass. A track named or programmed as a bass, otherwise the lowest line of
 * everything left over. It only counts as a real bass when it sits low
 * (median at or under G3) and plays for a good share of the song; otherwise
 * a bass is generated from the chords: roots on each chord window, the fifth
 * when a chord holds through a bar. Busy left-hand figuration is thinned to
 * one note per eighth, then per beat, so a bass section is playable.
 *
 * Chords. Each half bar (whole bar in short metres) gets a pitch-class
 * histogram from all voices; the chord is the key's triad (or a secondary
 * dominant, or tonal's exact detection) that covers the most sounding weight,
 * with nudges for a matching bass note, continuity and I, IV, V. The key
 * comes from the Krumhansl-Schmuckler profiles rather than the file's key
 * signature, which many files leave at C major.
 *
 * Harmony. When the file has inner voices, each harmony line chooses, at
 * every onset, the real note nearest its previous note, under the line above
 * it, avoiding pitch classes the upper lines already play: smooth voice
 * leading with the file's own notes. Chord tones fill moments the file leaves
 * empty. A bare melody instead gets a diatonic third below (a sixth when only
 * that is a chord tone), and the second harmony holds chord tones.
 *
 * Range. Each role goes to the instrument whose recorded range (the sample
 * bank) fits it with the least octave folding, weighed against role habits
 * (flute or violin on the tune, cello on the bass) and the file's own
 * programs, using each instrument once before doubling one. A whole-line
 * octave shift keeps the contour; only stray notes fold by an octave, which
 * can break a leap but never leaves a note without a recording.
 *
 * Playability and limits. Accompaniment moves at most once per eighth, a
 * tone it keeps holding is one note, rests under half a beat fold into the
 * note before them, and a part over the event budget (2000 per instrument, the whole
 * frame under 256 KB) is thinned further: repeats tie, then one note per
 * eighth, beat, half bar and bar. Over-long songs end at the latest phrase
 * boundary (a bar where most parts rest or sit on the tonic, preferably every
 * fourth bar) that fits the time limit.
 */

export type Role = 'melody' | 'harmony' | 'bass' | 'rhythm';

export interface ArrangeOptions {
  id: string;
  title: string;
  composer: string;
  maxParts: number;
  maxSeconds: number;
}

export interface PartReport {
  id: string;
  name: string;
  role: Role;
  instrument: InstrumentId;
  notes: number;
  range: Range;
  /** Whole-part octave shift applied to fit the instrument, in semitones */
  transpose: number;
}

export interface ImportReport {
  durationSec: number;
  bars: number;
  bpm: number;
  key: string;
  parts: PartReport[];
  warnings: string[];
}

export interface Arrangement {
  score: Score;
  report: ImportReport;
}

/** set_custom_piece limits */
export const MAX_TRACKS = CUSTOM_PIECE_LIMITS.maxTracks;
export const MAX_EVENTS_PER_TRACK = CUSTOM_PIECE_LIMITS.maxEventsPerTrack;
export const MAX_TITLE_LEN = CUSTOM_PIECE_LIMITS.maxTitleLen;
export const MAX_FRAME_BYTES = 256 * 1024;

const INSTRUMENTS: readonly InstrumentId[] = ['flute', 'violin', 'piano', 'cello'];

/** Recorded range of each instrument's main bank */
export const INSTRUMENT_RANGE: Record<InstrumentId, Range> = {
  violin: bankRange('violin'),
  cello: bankRange('cello'),
  flute: bankRange('flute'),
  piano: bankRange('piano'),
  // The General MIDI drum keys the kit answers to (see audio.ts)
  drums: { low: 35, high: 57 },
  // Standard tuning, low E to the 20th fret of the top string
  guitar: { low: 40, high: 84 },
};

function bankRange(instrument: InstrumentId): Range {
  const notes = BANK_NOTES[instrument];
  return { low: Math.min(...notes), high: Math.max(...notes) };
}

const LABEL: Record<InstrumentId, string> = { violin: 'Violin', cello: 'Cello', flute: 'Flute', piano: 'Piano', drums: 'Drums', guitar: 'Guitar' };

/** How natural each instrument is for each role (lower is better) */
const ROLE_COST: Record<Role, Record<InstrumentId, number>> = {
  // Drums never carry a pitched part: a MIDI file's drum channel is not arranged yet.
  melody: { flute: 0, violin: 0.3, piano: 1, cello: 3, drums: 99, guitar: 0.8 },
  harmony: { violin: 0, piano: 0.4, flute: 0.8, cello: 1.5, drums: 99, guitar: 0.2 },
  bass: { cello: 0, piano: 1.5, violin: 6, flute: 6, drums: 99, guitar: 2 },
  rhythm: { piano: 0, violin: 1.2, cello: 1.5, flute: 2, drums: 99, guitar: 0.1 },
};

/** Section sizes: the tune needs the biggest crowd */
const ROLE_WEIGHT: Record<Role, number> = { melody: 4, harmony: 3, bass: 3, rhythm: 2 };

const LEAD_NAME = /\b(melody|melodie|lead|vocals?|voice|solo|soprano|tune|theme|right|rh|treble)\b/i;
const BASS_NAME = /\b(bass|basso|cello|contrabass|tuba|bassoon|left|lh)\b/i;
/** A real bass sits at or below G3 */
const BASS_CEILING = 55;
/** Share of the song a line must sound for to count as a real part */
const MIN_COVERAGE = 0.15;
const SHORT_SONG_SEC = 120;

/** The Kilukkam instrument a General MIDI program sounds most like, if any. */
export function programFamily(program: number): InstrumentId | undefined {
  if (program <= 15 || (program >= 24 && program <= 31)) return 'piano';
  if ((program >= 32 && program <= 39) || program === 42 || program === 43 || program === 58 || program === 70) return 'cello';
  if ((program >= 40 && program <= 51) || program === 110) return 'violin';
  if (program === 68 || program === 69 || program === 71 || (program >= 72 && program <= 79)) return 'flute';
  return undefined;
}

const leadProgram = (p: number): boolean => p === 40 || p === 56 || (p >= 52 && p <= 54) || (p >= 64 && p <= 87 && p !== 70);
const bassLike = (v: Voice): boolean => BASS_NAME.test(v.name) || programFamily(v.program) === 'cello';

interface Voice {
  name: string;
  program: number;
  isPercussion: boolean;
  notes: StepNote[];
}

interface Part {
  id: string;
  role: Role;
  line: StepNote[];
  program: number | undefined;
}

interface PlacedPart extends Part {
  instrument: InstrumentId;
  shift: number;
  folded: number;
}

const noteKey = (n: StepNote): string => `${n.start}:${n.midi}`;

function toVoice(v: ParsedVoice, stepsPerBeat: number): Voice {
  return {
    name: v.name,
    program: v.program,
    isPercussion: v.isPercussion,
    notes: v.notes.map((n) => {
      const start = Math.round(n.startBeats * stepsPerBeat);
      return { midi: n.midi, start, end: start + Math.max(1, Math.round(n.durationBeats * stepsPerBeat)), velocity: n.velocity };
    }),
  };
}

/** Steps in which at least one note sounds */
export function coverage(notes: readonly StepNote[]): number {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let covered = 0;
  let reach = -Infinity;
  for (const n of sorted) {
    if (n.end <= reach) continue;
    covered += n.end - Math.max(n.start, reach);
    reach = n.end;
  }
  return covered;
}

const meanPitch = (line: Line): number => line.reduce((s, n) => s + n.midi * (n.end - n.start), 0) / Math.max(1, line.reduce((s, n) => s + n.end - n.start, 0));

function melodyScore(v: Voice, songSteps: number): number {
  const top = skyline(v.notes);
  let score = meanPitch(top);
  if (LEAD_NAME.test(v.name)) score += 12;
  if (leadProgram(v.program)) score += 4;
  if (bassLike(v)) score -= 24;
  if (coverage(top) < songSteps * 0.1) score -= 12;
  return score;
}

function pickMelodySource(voices: readonly Voice[], songSteps: number): Voice | undefined {
  let best: { v: Voice; s: number } | undefined;
  for (const v of voices) {
    const s = melodyScore(v, songSteps);
    if (!best || s > best.s) best = { v, s };
  }
  return best?.v;
}

const without = (notes: readonly StepNote[], used: Line): StepNote[] => {
  const keys = new Set(used.map(noteKey));
  return notes.filter((n) => !keys.has(noteKey(n)));
};

function pcHistogram(notes: readonly StepNote[]): number[] {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[pitchClass(n.midi)] = (hist[pitchClass(n.midi)] ?? 0) + (n.end - n.start);
  return hist;
}

/** The program of the voice a line borrowed most of its notes from, if it borrowed any. */
function dominantProgram(line: Line, voices: readonly Voice[]): number | undefined {
  const keys = new Set(line.map(noteKey));
  let best: { program: number; count: number } | undefined;
  for (const v of voices) {
    const count = v.notes.filter((n) => keys.has(noteKey(n))).length;
    if (count > 0 && (!best || count > best.count)) best = { program: v.program, count };
  }
  return best?.program;
}

/** Pitch class of the lowest note still sounding in the song's last beat */
function finalBassPc(notes: readonly StepNote[], stepsPerBeat: number): number | undefined {
  const end = Math.max(...notes.map((n) => n.end));
  const last = notes.filter((n) => n.end > end - stepsPerBeat);
  const low = last.reduce<StepNote | undefined>((lo, n) => (!lo || n.midi < lo.midi ? n : lo), undefined);
  return low === undefined ? undefined : pitchClass(low.midi);
}

interface Roles {
  key: KeyInfo;
  parts: Part[];
  notes: string[];
}

/** Find or build every role's line, in priority order. */
function buildRoles(voices: readonly Voice[], songSteps: number, grid: Grid): Roles {
  const pitched = voices.filter((v) => !v.isPercussion);
  const drums = voices.filter((v) => v.isPercussion).flatMap((v) => v.notes);
  const source = pickMelodySource(pitched, songSteps);
  if (!source) throw new Error('This MIDI file has no pitched notes to play.');
  const notes: string[] = [];

  const melody = skyline(source.notes);
  const others = pitched.filter((v) => v !== source);
  const pool = [...without(source.notes, melody), ...others.flatMap((v) => v.notes)];

  const bassVoice = others
    .filter(bassLike)
    .reduce<Voice | undefined>((low, v) => (!low || meanPitch(v.notes) < meanPitch(low.notes) ? v : low), undefined);
  const bottom = bottomline(bassVoice ? bassVoice.notes : pool);
  const isRealBass =
    bottom.length > 0 && coverage(bottom) >= songSteps * MIN_COVERAGE && (bassVoice !== undefined || median(bottom.map((n) => n.midi)) <= BASS_CEILING);
  const inner = isRealBass ? without(pool, bottom) : pool;
  const isRealHarmony = coverage(inner) >= songSteps * MIN_COVERAGE;

  const all = pitched.flatMap((v) => v.notes);
  const key = detectKey(pcHistogram(all), finalBassPc(all, grid.stepsPerBeat));
  const bassLine = isRealBass ? realBass(bottom, grid) : undefined;
  const map = chordMap(
    [
      { notes: melody, weight: 0.6 },
      { notes: inner, weight: 1 },
      { notes: bassLine ?? [], weight: 1.5 },
    ],
    bassLine,
    songSteps,
    grid.windowSteps,
    key,
  );

  const bass = bassLine ?? generatedBass(map, songSteps, grid);
  if (!bassLine) notes.push('No bass line in the file: built one from the chords.');

  let harmony1: StepNote[];
  let harmony2: StepNote[];
  if (isRealHarmony) {
    const times = voiceTimes(inner, map, songSteps, grid);
    harmony1 = leadVoice({ times, pool: inner, above: [melody], map, key, grid });
    harmony2 = leadVoice({ times, pool: without(inner, harmony1), above: [harmony1, melody], map, key, grid });
  } else {
    notes.push('No inner voices in the file: harmony is a third or sixth under the tune.');
    harmony1 = parallelHarmony(melody, map, key, grid);
    harmony2 = leadVoice({ times: voiceTimes([], map, songSteps, grid), pool: [], above: [harmony1, melody], map, key, grid });
  }

  const parts: Part[] = [
    { id: 'melody', role: 'melody', line: melody, program: source.program },
    { id: 'bass', role: 'bass', line: bass, program: bassVoice?.program },
    { id: 'harmony-1', role: 'harmony', line: harmony1, program: dominantProgram(harmony1, others) },
    { id: 'rhythm', role: 'rhythm', line: drums.length > 0 ? rhythmLine(drums, map, key, grid) : [], program: undefined },
    { id: 'harmony-2', role: 'harmony', line: harmony2, program: dominantProgram(harmony2, others) },
  ];
  return { key, parts: parts.filter((p) => p.line.length > 0), notes };
}

/**
 * The latest bar boundary within `maxBars` where the music breathes: most
 * parts rest through the last beat or hold the tonic. Every fourth and
 * eighth bar scores a little extra, since phrases come in fours.
 */
export function phraseEnd(lines: readonly Line[], maxBars: number, key: KeyInfo, grid: Grid): number {
  const score = (bar: number): number => {
    const end = bar * grid.barSteps;
    const settled = lines.filter((line) => {
      const last = noteAt(line, end - 1);
      return last === undefined || last.end <= end - grid.stepsPerBeat || pitchClass(last.midi) === key.tonic;
    }).length;
    return settled / Math.max(1, lines.length) + (bar % 4 === 0 ? 0.25 : 0) + (bar % 8 === 0 ? 0.1 : 0);
  };
  let best = { bar: maxBars, s: -Infinity };
  for (let bar = maxBars; bar >= Math.max(1, Math.floor(maxBars * 0.75)); bar--) {
    const s = score(bar);
    if (s > best.s) best = { bar, s };
  }
  return best.bar;
}

function placeParts(parts: readonly Part[]): PlacedPart[] {
  const used = new Map<InstrumentId, number>();
  const placed: PlacedPart[] = [];
  for (const part of parts) {
    // A harmony sits under the line above it: harmony 1 under the melody, harmony 2 under harmony 1.
    const upper = part.role === 'harmony' ? [...placed].reverse().find((p) => p.role === 'harmony' || p.role === 'melody') : undefined;
    const ceiling = upper ? median(upper.line.map((n) => n.midi)) : undefined;
    let best: { cost: number; p: PlacedPart } | undefined;
    for (const instrument of INSTRUMENTS) {
      const fit = fitRange(part.line, INSTRUMENT_RANGE[instrument], ceiling);
      const cost =
        ROLE_COST[part.role][instrument] +
        (used.get(instrument) ?? 0) +
        (part.program !== undefined && programFamily(part.program) === instrument ? -0.5 : 0) +
        (fit.above ? 1.5 : 0) +
        (fit.folded / part.line.length) * 10 +
        (Math.abs(fit.shift) / 12) * 0.3;
      if (!best || cost < best.cost) best = { cost, p: { ...part, instrument, line: fit.line, shift: fit.shift, folded: fit.folded } };
    }
    if (best) {
      placed.push(best.p);
      used.set(best.p.instrument, (used.get(best.p.instrument) ?? 0) + 1);
    }
  }
  return placed;
}

/** Thin a line, gentlest first, until it renders to at most `maxEvents`. */
export function simplify(line: Line, maxEvents: number, totalSteps: number, grid: Grid): StepNote[] {
  const minGap = Math.ceil(grid.stepsPerBeat / 2);
  const stages: ((l: Line) => StepNote[])[] = [
    (l) => mergeRepeats(l, grid.barSteps),
    (l) => thinToCells(l, eighthSteps(grid), 'first'),
    (l) => thinToCells(l, grid.stepsPerBeat, 'first'),
    (l) => thinToCells(l, grid.windowSteps, 'first'),
    (l) => thinToCells(l, grid.barSteps, 'first'),
  ];
  let current = [...line];
  for (const stage of stages) {
    if (eventCount(current, totalSteps) <= maxEvents) return current;
    current = absorbShortRests(stage(current), minGap);
  }
  while (current.length > 0 && eventCount(current, totalSteps) > maxEvents) current.pop();
  return current;
}

/** Split MAX_PLAYERS by role weight, largest remainder first, earlier parts winning ties. */
export function sectionSizes(roles: readonly Role[]): number[] {
  const total = roles.reduce((s, r) => s + ROLE_WEIGHT[r], 0);
  const exact = roles.map((r) => (MAX_PLAYERS * ROLE_WEIGHT[r]) / total);
  const sizes = exact.map(Math.floor);
  let left = MAX_PLAYERS - sizes.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    sizes[i] = (sizes[i] ?? 0) + 1;
    left -= 1;
  }
  return sizes;
}

function partNames(parts: readonly PlacedPart[]): string[] {
  const totals = new Map<InstrumentId, number>();
  for (const p of parts) totals.set(p.instrument, (totals.get(p.instrument) ?? 0) + 1);
  const seen = new Map<InstrumentId, number>();
  return parts.map((p) => {
    const n = (seen.get(p.instrument) ?? 0) + 1;
    seen.set(p.instrument, n);
    return (totals.get(p.instrument) ?? 1) > 1 ? `${LABEL[p.instrument]} ${n}` : LABEL[p.instrument];
  });
}

export function cleanTitle(raw: string): string {
  const clean = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...(clean || 'Imported song')].slice(0, MAX_TITLE_LEN).join('').trim();
}

function partReport(p: PlacedPart, t: Track): PartReport {
  const notes = t.events.flatMap((e) => (e.kind === 'note' ? [e.midi] : []));
  return {
    id: t.id,
    name: t.name,
    role: p.role,
    instrument: t.instrument,
    notes: notes.length,
    range: { low: Math.min(...notes), high: Math.max(...notes) },
    transpose: p.shift,
  };
}

const frameBytes = (score: Score): number => new TextEncoder().encode(JSON.stringify({ type: 'set_custom_piece', score })).length;

const formatSec = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function arrange(song: ParsedSong, opts: ArrangeOptions): Arrangement {
  const warnings: string[] = [];
  const stepsPerBeat = Math.round(1 / song.gridBeats);
  const barSteps = Math.max(1, Math.round(song.beatsPerBar * stepsPerBeat));
  const grid: Grid = {
    stepsPerBeat,
    barSteps,
    windowSteps: song.beatsPerBar >= 4 && barSteps % 2 === 0 ? barSteps / 2 : barSteps,
  };

  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(song.bpm)));
  if (bpm !== Math.round(song.bpm)) warnings.push(`Tempo ${Math.round(song.bpm)} bpm is outside ${MIN_BPM} to ${MAX_BPM}: set to ${bpm}.`);
  if (song.tempoChanges > 0) warnings.push(`The file changes tempo ${song.tempoChanges} times: it plays at a steady ${bpm} bpm.`);

  // Skip whole empty bars before the first note so the room starts playing at once.
  const raw = song.voices.map((v) => toVoice(v, stepsPerBeat));
  const first = Math.min(...raw.flatMap((v) => v.notes.map((n) => n.start)));
  if (!Number.isFinite(first)) throw new Error('This MIDI file has no notes.');
  const lead = Math.floor(first / barSteps) * barSteps;
  const voices = raw.map((v) => ({ ...v, notes: v.notes.map((n) => ({ ...n, start: n.start - lead, end: n.end - lead })) }));
  const lastEnd = Math.max(...voices.flatMap((v) => v.notes.map((n) => n.end)));
  const fullSteps = Math.ceil(lastEnd / barSteps) * barSteps;

  const roles = buildRoles(voices, fullSteps, grid);
  warnings.push(...roles.notes);
  let parts = roles.parts.slice(0, Math.min(opts.maxParts, MAX_TRACKS));

  const secPerBar = (barSteps / stepsPerBeat) * (60 / bpm);
  const fullBars = fullSteps / barSteps;
  let totalSteps = fullSteps;
  if (fullBars * secPerBar > opts.maxSeconds) {
    const maxBars = Math.max(1, Math.floor(opts.maxSeconds / secPerBar));
    const bars = phraseEnd(
      parts.map((p) => p.line),
      maxBars,
      roles.key,
      grid,
    );
    totalSteps = bars * barSteps;
    parts = parts.map((p) => ({ ...p, line: truncate(p.line, totalSteps) })).filter((p) => p.line.length > 0);
    warnings.push(
      `The song runs ${formatSec(fullBars * secPerBar)}: trimmed to the first ${bars} of ${fullBars} bars (${formatSec(bars * secPerBar)}), ending on a phrase.`,
    );
  }

  const minGap = Math.ceil(stepsPerBeat / 2);
  const placed = placeParts(parts.map((p) => ({ ...p, line: absorbShortRests(p.line, minGap) })));
  const names = partNames(placed);
  const sizes = sectionSizes(placed.map((p) => p.role));
  for (const [i, p] of placed.entries()) {
    if (p.folded > 0) warnings.push(`${names[i] ?? p.id}: ${p.folded} notes moved by an octave to stay in range.`);
  }

  const caps = placed.map(() => MAX_EVENTS_PER_TRACK);
  const build = (): Score => ({
    id: opts.id,
    title: cleanTitle(opts.title),
    composer: opts.composer,
    bpm,
    beatsPerBar: song.beatsPerBar,
    tracks: placed.map(
      (p, i): Track => ({
        id: p.id,
        name: names[i] ?? p.id,
        instrument: p.instrument,
        maxPlayers: sizes[i] ?? 1,
        events: toEvents(simplify(p.line, caps[i] ?? MAX_EVENTS_PER_TRACK, totalSteps, grid), totalSteps, stepsPerBeat),
      }),
    ),
  });

  let score = build();
  // Keep the whole message under the frame limit by squeezing the busiest part.
  while (frameBytes(score) > MAX_FRAME_BYTES) {
    const counts = score.tracks.map((t) => t.events.length);
    const busiest = counts.indexOf(Math.max(...counts));
    caps[busiest] = Math.floor((counts[busiest] ?? 0) * 0.8);
    score = build();
  }
  score.tracks.forEach((t, i) => {
    const before = eventCount(placed[i]?.line ?? [], totalSteps);
    if (t.events.length < before) warnings.push(`${t.name}: simplified from ${before} to ${t.events.length} notes and rests to fit the room.`);
  });

  const errors = validateScore(score);
  if (errors.length > 0) throw new Error(`Arranged score is invalid: ${errors.join('; ')}`);

  const durationSec = (totalSteps / stepsPerBeat) * (60 / bpm);
  if (durationSec < SHORT_SONG_SEC) warnings.push(`Short piece: ${formatSec(durationSec)}, under two minutes.`);

  return {
    score,
    report: {
      durationSec,
      bars: totalSteps / barSteps,
      bpm,
      key: roles.key.name,
      parts: placed.flatMap((p, i) => {
        const t = score.tracks[i];
        return t ? [partReport(p, t)] : [];
      }),
      warnings,
    },
  };
}
