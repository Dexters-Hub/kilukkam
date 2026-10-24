import { Chord, Key, Note } from 'tonal';

// Tonal facts the arranger leans on: which key the song is in, which chords
// that key offers, which chord a moment of music most likely is, and how to
// walk up and down the scale. Pitch classes are 0 (C) to 11 (B).

export type Mode = 'major' | 'minor';

export interface KeyInfo {
  tonic: number;
  mode: Mode;
  /** Human label, e.g. "G major" */
  name: string;
  /** The seven scale pitch classes, tonic first */
  scale: readonly number[];
}

export interface ChordInfo {
  /** Symbol as tonal spells it, e.g. "Am" */
  name: string;
  root: number;
  tones: readonly number[];
  /** Built from the key's own scale (secondary dominants and detected chromatic chords are not) */
  diatonic: boolean;
}

/** Duration-weighted pitch-class histogram, 12 bins */
export type PcHistogram = readonly number[];

const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'] as const;

// Krumhansl and Kessler probe-tone profiles: how well each scale degree fits a key.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

const chroma = (name: string): number => {
  const c = Note.chroma(name);
  return c === undefined ? 0 : c;
};

const nameOf = (pc: number, mode: Mode): string => (mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[pitchClass(pc)] ?? 'C';

const correlation = (a: readonly number[], b: readonly number[]): number => {
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    const y = b[i] ?? 0;
    num += (x - ma) * (y - mb);
    da += (x - ma) ** 2;
    db += (y - mb) ** 2;
  });
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
};

export function keyInfo(tonic: number, mode: Mode): KeyInfo {
  const name = nameOf(tonic, mode);
  const scale = mode === 'major' ? Key.majorKey(name).scale : Key.minorKey(name).natural.scale;
  return { tonic: pitchClass(tonic), mode, name: `${name} ${mode}`, scale: scale.map(chroma) };
}

/** Correlation bonus for a key whose tonic is the song's final bass note: music usually ends at home. */
const FINAL_TONIC_BONUS = 0.15;

/**
 * Krumhansl-Schmuckler: the key whose profile best correlates with how long
 * each pitch class sounds, nudged toward the key the song ends in.
 */
export function detectKey(hist: PcHistogram, finalPc?: number): KeyInfo {
  let best = { tonic: 0, mode: 'major' as Mode, r: -Infinity };
  for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = profile.map((_, pc) => profile[pitchClass(pc - tonic)] ?? 0);
      const r = correlation(hist, rotated) + (tonic === finalPc ? FINAL_TONIC_BONUS : 0);
      if (r > best.r) best = { tonic, mode, r };
    }
  }
  return keyInfo(best.tonic, best.mode);
}

const chordFrom = (symbol: string, diatonic: boolean): ChordInfo | undefined => {
  const c = Chord.get(symbol);
  if (c.empty || c.tonic === null) return undefined;
  return { name: c.symbol, root: chroma(c.tonic), tones: c.notes.map(chroma), diatonic };
};

/** The triads a key offers, plus the secondary dominants (as plain major triads) for chromatic moments. */
export function keyChords(key: KeyInfo): ChordInfo[] {
  const tonicName = nameOf(key.tonic, key.mode);
  let triads: readonly string[];
  let secondary: readonly string[];
  if (key.mode === 'major') {
    const k = Key.majorKey(tonicName);
    triads = k.triads;
    secondary = k.secondaryDominants;
  } else {
    const k = Key.minorKey(tonicName);
    // Natural minor triads plus the harmonic minor's major V and diminished vii.
    triads = [...k.natural.triads, k.harmonic.triads[4] ?? '', k.harmonic.triads[6] ?? ''];
    secondary = k.natural.secondaryDominants;
  }
  const out: ChordInfo[] = [];
  const seen = new Set<string>();
  const add = (c: ChordInfo | undefined) => {
    if (!c) return;
    const id = `${c.root}:${[...c.tones].sort((a, b) => a - b).join(',')}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(c);
  };
  for (const t of triads) if (t) add(chordFrom(t, true));
  for (const s of secondary) {
    const root = s ? Chord.get(s).tonic : null;
    if (root) add(chordFrom(`${root}M`, false));
  }
  return out;
}

/**
 * Triads only: with four pitch classes a passing melody note turns G into
 * "Em7" and moves the root, and tonal also offers readings such as "Em#5/C".
 */
const PLAIN_TYPES = new Set(['major', 'minor', 'diminished']);

/**
 * Tonal's exact reading of the three strongest pitch classes, when it is a
 * plain triad. This is what catches chromatic chords the key does not list,
 * such as a borrowed iv or bVI.
 */
export function detectExact(hist: PcHistogram): ChordInfo | undefined {
  const max = Math.max(...hist);
  if (!(max > 0)) return undefined;
  const strong = hist
    .map((w, pc) => ({ w, pc }))
    .filter((x) => x.w >= max * 0.2)
    .sort((a, b) => b.w - a.w || a.pc - b.pc)
    .slice(0, 3)
    .map((x) => MAJOR_NAMES[x.pc] ?? 'C');
  if (strong.length < 3) return undefined;
  const symbol = Chord.detect(strong).find((s) => PLAIN_TYPES.has(Chord.get(s).type));
  return symbol === undefined ? undefined : chordFrom(symbol, false);
}

const isDiatonic = (c: ChordInfo, key: KeyInfo): boolean => c.tones.every((t) => key.scale.includes(t));

export interface ChordContext {
  key: KeyInfo;
  candidates: readonly ChordInfo[];
  previous: ChordInfo | undefined;
  /** Pitch class of the lowest note in the window, when the song has a real bass */
  bassPc: number | undefined;
}

/**
 * Template matching: reward the weight of chord tones, punish the weight of
 * non-chord tones, and nudge toward continuity, a matching bass and the
 * primary triads so a bare melody harmonises with I, IV and V first.
 */
export function scoreChord(chord: ChordInfo, hist: PcHistogram, ctx: ChordContext): number {
  const total = hist.reduce((s, w) => s + w, 0) || 1;
  let fit = 0;
  hist.forEach((w, pc) => {
    fit += chord.tones.includes(pc) ? w : -0.6 * w;
  });
  let score = fit / total;
  if (ctx.previous && ctx.previous.name === chord.name) score += 0.08;
  if (ctx.bassPc !== undefined && chord.root === ctx.bassPc) score += 0.15;
  const degree = ctx.key.scale.indexOf(chord.root);
  if (chord.diatonic && (degree === 0 || degree === 3 || degree === 4)) score += degree === 0 ? 0.05 : 0.03;
  if (!chord.diatonic) score -= 0.1;
  return score;
}

export function pickChord(hist: PcHistogram, ctx: ChordContext): ChordInfo | undefined {
  const exact = detectExact(hist);
  const pool = exact ? [...ctx.candidates, { ...exact, diatonic: isDiatonic(exact, ctx.key) }] : ctx.candidates;
  let best: { c: ChordInfo; s: number } | undefined;
  for (const c of pool) {
    const s = scoreChord(c, hist, ctx);
    if (!best || s > best.s) best = { c, s };
  }
  return best?.c;
}

export function tonicChord(key: KeyInfo): ChordInfo {
  const third = key.scale[2] ?? pitchClass(key.tonic + (key.mode === 'major' ? 4 : 3));
  const fifth = key.scale[4] ?? pitchClass(key.tonic + 7);
  return { name: key.name, root: key.tonic, tones: [key.tonic, third, fifth], diatonic: true };
}

/**
 * Move `steps` scale degrees from `midi` (negative is down). A chromatic start
 * note first snaps down to the scale, so the result is always diatonic.
 */
export function scaleStep(midi: number, steps: number, scale: readonly number[]): number {
  let m = midi;
  while (!scale.includes(pitchClass(m))) m -= 1;
  const dir = Math.sign(steps);
  for (let left = Math.abs(steps); left > 0; ) {
    m += dir;
    if (scale.includes(pitchClass(m))) left -= 1;
  }
  return m;
}
