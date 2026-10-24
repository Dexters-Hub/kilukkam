import { bottomline, noteAt, thinToCells, type Line, type StepNote } from './lines.js';
import { keyChords, pickChord, pitchClass, scaleStep, tonicChord, type ChordInfo, type KeyInfo } from './theory.js';

// Builders for each part of an arrangement: the chord map, a real or
// generated bass, voice-led harmony lines, parallel harmony under a bare
// melody, and a pitched rhythm part from a drum track.

export interface Grid {
  stepsPerBeat: number;
  barSteps: number;
  /** Harmonic rhythm: one chord per half bar in long bars, per bar otherwise */
  windowSteps: number;
}

/** One eighth note, or one triplet eighth on a triplet grid */
export const eighthSteps = (g: Grid): number => (g.stepsPerBeat % 2 === 0 ? g.stepsPerBeat / 2 : 1);

export interface ChordMap {
  chords: readonly ChordInfo[];
  /** Whether anything sounds in each window; silent windows get no accompaniment */
  active: readonly boolean[];
  windowSteps: number;
}

export const windowOf = (map: ChordMap, step: number): number =>
  Math.min(map.chords.length - 1, Math.max(0, Math.floor(step / map.windowSteps)));

export const chordAt = (map: ChordMap, step: number, key: KeyInfo): ChordInfo => map.chords[windowOf(map, step)] ?? tonicChord(key);

export const isActive = (map: ChordMap, step: number): boolean => map.active[windowOf(map, step)] ?? false;

export interface WeightedNotes {
  notes: readonly StepNote[];
  weight: number;
}

/** Histogram each window from every voice that sounds in it, then pick the best-fitting chord in turn. */
export function chordMap(groups: readonly WeightedNotes[], bass: Line | undefined, totalSteps: number, windowSteps: number, key: KeyInfo): ChordMap {
  const count = Math.max(1, Math.ceil(totalSteps / windowSteps));
  const hists = Array.from({ length: count }, () => new Array<number>(12).fill(0));
  for (const { notes, weight } of groups) {
    for (const n of notes) {
      for (let w = Math.floor(n.start / windowSteps); w <= Math.floor((n.end - 1) / windowSteps) && w < count; w++) {
        const overlap = Math.min(n.end, (w + 1) * windowSteps) - Math.max(n.start, w * windowSteps);
        const h = hists[w];
        if (h) h[pitchClass(n.midi)] = (h[pitchClass(n.midi)] ?? 0) + overlap * weight;
      }
    }
  }
  const lowest = new Array<number | undefined>(count).fill(undefined);
  for (const n of bass ?? []) {
    const w = Math.floor(n.start / windowSteps);
    const current = lowest[w];
    if (w < count && (current === undefined || n.midi < current)) lowest[w] = n.midi;
  }
  const candidates = keyChords(key);
  const chords: ChordInfo[] = [];
  let previous: ChordInfo | undefined;
  hists.forEach((h, w) => {
    const low = lowest[w];
    const picked = h.some((x) => x > 0)
      ? pickChord(h, { key, candidates, previous, bassPc: low === undefined ? undefined : pitchClass(low) })
      : previous;
    previous = picked ?? previous ?? tonicChord(key);
    chords.push(previous);
  });
  return { chords, active: hists.map((h) => h.some((x) => x > 0)), windowSteps };
}

/** Nearest instance of a pitch class to `target` inside [low, high]; ties go to `preferHigh`'s side. */
export function placePc(pc: number, target: number, low: number, high: number, preferHigh = false): number {
  let best: number | undefined;
  for (let m = low; m <= high; m++) {
    if (pitchClass(m) !== pc) continue;
    if (best === undefined) best = m;
    else {
      const d = Math.abs(m - target);
      const bd = Math.abs(best - target);
      if (d < bd || (d === bd && preferHigh)) best = m;
    }
  }
  return best ?? low + pitchClass(pc - low);
}

const BASS_LOW = 36;
const BASS_HIGH = 55;
const BASS_VELOCITY = 84;
const HARMONY_VELOCITY = 72;

/**
 * The lowest real voice, thinned to one onset per eighth (lowest wins). If
 * it still moves faster than one and a half notes a beat (piano figuration
 * such as an Alberti bass), it thins again to one note a beat.
 */
export function realBass(notes: readonly StepNote[], grid: Grid): StepNote[] {
  const eighths = thinToCells(bottomline(notes), eighthSteps(grid), 'lowest');
  const beatsSounding = new Set(eighths.map((n) => Math.floor(n.start / grid.stepsPerBeat))).size;
  return eighths.length > beatsSounding * 1.5 ? thinToCells(eighths, grid.stepsPerBeat, 'lowest') : eighths;
}

const fifthOf = (c: ChordInfo): number => {
  const fifth = pitchClass(c.root + 7);
  return c.tones.includes(fifth) ? fifth : (c.tones.find((t) => t !== c.root) ?? c.root);
};

/**
 * Roots on each chord window; when a chord carries on past a bar's first
 * window, the bass moves to its fifth (the classic root, fifth half notes).
 * Each note is the nearest octave to the last, so the line walks, not leaps.
 */
export function generatedBass(map: ChordMap, totalSteps: number, grid: Grid): StepNote[] {
  const out: StepNote[] = [];
  let prev = 43;
  map.chords.forEach((c, w) => {
    const start = w * map.windowSteps;
    if (!map.active[w] || start >= totalSteps) return;
    const before = map.chords[w - 1];
    const carriesOn = before?.name === c.name && start % grid.barSteps !== 0;
    const midi = placePc(carriesOn ? fifthOf(c) : c.root, prev, BASS_LOW, BASS_HIGH);
    out.push({ midi, start, end: Math.min(totalSteps, start + map.windowSteps), velocity: BASS_VELOCITY });
    prev = midi;
  });
  return out;
}

/**
 * A third under each melody note, or a sixth when only the sixth is in the
 * chord: the stock way to add a second voice to a tune. Diatonic, so it
 * never clashes with the key; it shares the tune's rhythm, thinned to eighths.
 */
export function parallelHarmony(melody: Line, map: ChordMap, key: KeyInfo, grid: Grid): StepNote[] {
  let prev: number | undefined;
  const line = melody.map((n) => {
    const tones = chordAt(map, n.start, key).tones;
    const third = scaleStep(n.midi, -2, key.scale);
    const sixth = scaleStep(n.midi, -5, key.scale);
    const inChord = [third, sixth].filter((m) => tones.includes(pitchClass(m)));
    const options = inChord.length > 0 ? inChord : [third];
    const target = prev ?? third;
    const midi = options.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best));
    prev = midi;
    return { ...n, midi, velocity: Math.min(n.velocity, HARMONY_VELOCITY) };
  });
  return thinToCells(line, eighthSteps(grid), 'first');
}

interface Candidate {
  midi: number;
  end: number;
  velocity: number;
  /** The file's note this comes from; undefined for a chord tone */
  source: StepNote | undefined;
}

export interface LeadOptions {
  /** Steps where the voice may move, sorted and unique */
  times: readonly number[];
  /** Real notes from the file to choose from; empty means chord tones only */
  pool: readonly StepNote[];
  /** Lines above this voice, nearest first: it stays under the first one sounding */
  above: readonly Line[];
  map: ChordMap;
  key: KeyInfo;
  grid: Grid;
}

/**
 * One inner voice by voice leading: at each moment take the candidate
 * nearest the previous note, below the voice above it, preferring a pitch
 * class the upper voices are not already playing. Real notes from the file
 * come first, chord tones fill in when the file has none to offer.
 */
export function leadVoice({ times, pool, above, map, key, grid }: LeadOptions): StepNote[] {
  const sorted = [...pool].sort((a, b) => a.start - b.start);
  let next = 0;
  let sounding: StepNote[] = [];
  let prev: number | undefined;
  let lastSource: StepNote | undefined;
  const out: StepNote[] = [];

  times.forEach((t, i) => {
    while (next < sorted.length && (sorted[next]?.start ?? Infinity) <= t) {
      const n = sorted[next];
      if (n) sounding.push(n);
      next += 1;
    }
    sounding = sounding.filter((n) => n.end > t);
    if (!isActive(map, t)) return;

    const upper = above.map((l) => noteAt(l, t)).filter((n): n is StepNote => n !== undefined);
    const ceiling = upper[0]?.midi ?? (prev === undefined ? undefined : prev + 5);
    const avoid = new Set(upper.map((n) => pitchClass(n.midi)));
    const windowEnd = (windowOf(map, t) + 1) * map.windowSteps;

    const real: Candidate[] = sounding
      .filter((n) => ceiling === undefined || n.midi < ceiling)
      .map((n) => ({ midi: n.midi, end: n.end, velocity: n.velocity, source: n }));
    const top = (ceiling ?? 68) - 1;
    const tones: Candidate[] = chordAt(map, t, key).tones.map((pc) => ({
      midi: placePc(pc, prev ?? top, top - 14, top, true),
      end: windowEnd,
      velocity: HARMONY_VELOCITY,
      source: undefined,
    }));
    const fresh = (cs: Candidate[]) => cs.filter((c) => !avoid.has(pitchClass(c.midi)));
    const tiers = [fresh(real), fresh(tones), real, tones];
    const options = tiers.find((tier) => tier.length > 0) ?? [];
    const target = prev ?? top;
    const chosen = options.reduce<Candidate | undefined>((best, c) => {
      if (!best) return c;
      const d = Math.abs(c.midi - target);
      const bd = Math.abs(best.midi - target);
      return d < bd || (d === bd && c.midi > best.midi) ? c : best;
    }, undefined);
    if (!chosen) return;
    const end = Math.min(times[i + 1] ?? Infinity, chosen.end);
    if (end <= t) return;
    // Staying on a note the file still holds, or on the same chord tone, is one held note, not a new tap.
    const last = out.at(-1);
    const holds = last !== undefined && last.end === t && last.midi === chosen.midi && chosen.source === lastSource;
    if (holds && (chosen.source !== undefined || end - last.start <= grid.barSteps)) out[out.length - 1] = { ...last, end };
    else out.push({ midi: chosen.midi, start: t, end, velocity: chosen.velocity });
    prev = chosen.midi;
    lastSource = chosen.source;
  });
  return out;
}

/** Onsets of `notes` plus every chord change, at most one per eighth. */
export function voiceTimes(notes: readonly StepNote[], map: ChordMap, totalSteps: number, grid: Grid): number[] {
  const cell = eighthSteps(grid);
  const starts = new Set(notes.map((n) => n.start));
  for (let s = 0; s < totalSteps; s += map.windowSteps) starts.add(s);
  const out: number[] = [];
  for (const s of [...starts].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (s < totalSteps && (last === undefined || Math.floor(last / cell) !== Math.floor(s / cell))) out.push(s);
  }
  return out;
}

const KICKS = new Set([35, 36]);
const SNARES = new Set([37, 38, 39, 40]);
const RHYTHM_LOW = 55;
const RHYTHM_HIGH = 66;

/**
 * Drums become a pitched pulse a phone can tap: the chord root on a kick,
 * its fifth on a snare, short notes, one per eighth at most. Without enough
 * kicks and snares it follows every drum hit on the root.
 */
export function rhythmLine(drums: readonly StepNote[], map: ChordMap, key: KeyInfo, grid: Grid): StepNote[] {
  const core = drums.filter((n) => KICKS.has(n.midi) || SNARES.has(n.midi));
  const hits = thinToCells(
    [...(core.length >= 8 ? core : drums)].sort((a, b) => a.start - b.start || a.midi - b.midi).filter((n, i, all) => all[i - 1]?.start !== n.start),
    eighthSteps(grid),
    'first',
  );
  return hits.map((n, i) => {
    const c = chordAt(map, n.start, key);
    const pc = SNARES.has(n.midi) ? fifthOf(c) : c.root;
    const end = Math.min(hits[i + 1]?.start ?? Infinity, n.start + eighthSteps(grid));
    return { midi: placePc(pc, RHYTHM_LOW, RHYTHM_LOW, RHYTHM_HIGH), start: n.start, end, velocity: SNARES.has(n.midi) ? 76 : 90 };
  });
}
