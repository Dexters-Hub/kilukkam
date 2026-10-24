import tonejs from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, odeToJoy, totalBeats, validateScore, type ScoreEvent } from '@kilukkam/shared';
import { importMidi, type ImportResult } from '../src/lib/midi/index.js';
import {
  INSTRUMENT_RANGE,
  MAX_EVENTS_PER_TRACK,
  MAX_FRAME_BYTES,
  MAX_TITLE_LEN,
  MAX_TRACKS,
  cleanTitle,
  sectionSizes,
  simplify,
} from '../src/lib/midi/arrange.js';
import { bottomline, eventCount, fitRange, skyline, thinToCells, type StepNote } from '../src/lib/midi/lines.js';
import { hasTripletFeel, parseMidi, quantise } from '../src/lib/midi/parse.js';
import { detectKey, keyChords, keyInfo, pickChord, scaleStep } from '../src/lib/midi/theory.js';

const { Midi } = tonejs;

// Every MIDI file here is written in the test with @tonejs/midi's writer.

interface SpecNote {
  midi: number;
  beat: number;
  dur: number;
  vel?: number;
}

interface SpecTrack {
  name?: string;
  program?: number;
  channel?: number;
  notes: SpecNote[];
}

interface Spec {
  name?: string;
  tempos?: { beat: number; bpm: number }[];
  timeSignature?: [number, number];
  tracks: SpecTrack[];
}

function writeMidi(spec: Spec): ArrayBuffer {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  if (spec.name) midi.header.name = spec.name;
  midi.header.tempos = (spec.tempos ?? [{ beat: 0, bpm: 100 }]).map((t) => ({ ticks: Math.round(t.beat * ppq), bpm: t.bpm }));
  if (spec.timeSignature) midi.header.timeSignatures = [{ ticks: 0, timeSignature: spec.timeSignature }];
  midi.header.update();
  for (const t of spec.tracks) {
    const track = midi.addTrack();
    if (t.name) track.name = t.name;
    track.channel = t.channel ?? 0;
    track.instrument.number = t.program ?? 0;
    for (const n of t.notes) {
      track.addNote({ midi: n.midi, ticks: Math.round(n.beat * ppq), durationTicks: Math.round(n.dur * ppq), velocity: (n.vel ?? 90) / 127 });
    }
  }
  const bytes = midi.toArray();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Lay a list of score events end to end as notes from `from` beats. */
function eventsToNotes(events: readonly ScoreEvent[], from = 0, transpose = 0): SpecNote[] {
  const out: SpecNote[] = [];
  let beat = from;
  for (const e of events) {
    if (e.kind === 'note') out.push({ midi: e.midi + transpose, beat, dur: e.beats });
    beat += e.beats;
  }
  return out;
}

const repeat = (notes: readonly SpecNote[], times: number, every: number): SpecNote[] =>
  Array.from({ length: times }, (_, i) => notes.map((n) => ({ ...n, beat: n.beat + i * every }))).flat();

const ode = (role: string): ScoreEvent[] => odeToJoy.tracks.find((t) => t.id === role)?.events ?? [];
const ODE_BEATS = totalBeats(ode('flute'));

/** Block triads, one per half bar, following Ode to Joy's harmony. */
const CHORDS: number[][] = [
  [60, 64, 67], [60, 64, 67], [55, 59, 62], [55, 59, 62],
  [60, 64, 67], [60, 64, 67], [55, 59, 62], [55, 59, 62],
  [60, 64, 67], [60, 64, 67], [55, 59, 62], [55, 59, 62],
  [60, 64, 67], [60, 64, 67], [55, 59, 62], [60, 64, 67],
];
const chordNotes = (from: number): SpecNote[] =>
  CHORDS.flatMap((chord, i) => chord.map((midi) => ({ midi, beat: from + i * 2, dur: 2, vel: 70 })));

const melodyOnly = (): ArrayBuffer =>
  writeMidi({ name: 'Ode melody', tracks: [{ name: 'Melody', program: 73, notes: repeat(eventsToNotes(ode('flute')), 4, ODE_BEATS) }] });

const melodyAndChords = (): ArrayBuffer =>
  writeMidi({
    tracks: [
      { name: 'Lead', program: 73, notes: repeat(eventsToNotes(ode('flute')), 4, ODE_BEATS) },
      { name: 'Chords', program: 0, notes: repeat(chordNotes(0), 4, ODE_BEATS) },
    ],
  });

const fourTracks = (): ArrayBuffer =>
  writeMidi({
    name: 'Ode to Joy',
    tracks: [
      { name: 'Cello', program: 42, notes: repeat(eventsToNotes(ode('cello')), 4, ODE_BEATS) },
      { name: 'Piano', program: 0, notes: repeat(eventsToNotes(ode('piano')), 4, ODE_BEATS) },
      { name: 'Violin', program: 40, notes: repeat(eventsToNotes(ode('violin')), 4, ODE_BEATS) },
      { name: 'Flute', program: 73, notes: repeat(eventsToNotes(ode('flute')), 4, ODE_BEATS) },
    ],
  });

/** A straight eighth-note kick and snare groove under the melody */
const drumNotes = (beats: number): SpecNote[] =>
  Array.from({ length: beats * 2 }, (_, i) => ({ midi: i % 4 === 2 ? 38 : i % 2 === 0 ? 36 : 42, beat: i / 2, dur: 0.25, vel: 100 }));

function invariants(result: ImportResult, maxSeconds = 300): void {
  const { score, report } = result;
  expect(validateScore(score)).toEqual([]);
  expect(score.tracks.length).toBeGreaterThan(0);
  expect(score.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
  expect(score.title.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
  expect(new TextEncoder().encode(JSON.stringify({ type: 'set_custom_piece', score })).length).toBeLessThanOrEqual(MAX_FRAME_BYTES);

  const total = totalBeats(score.tracks[0]?.events ?? []);
  for (const t of score.tracks) {
    expect(t.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_TRACK);
    expect(totalBeats(t.events)).toBeCloseTo(total, 9);
    const range = INSTRUMENT_RANGE[t.instrument];
    for (const e of t.events) {
      expect(e.beats).toBeGreaterThan(0);
      if (e.kind === 'note') {
        expect(e.midi).toBeGreaterThanOrEqual(range.low);
        expect(e.midi).toBeLessThanOrEqual(range.high);
      }
    }
    // Two rests in a row would mean a gap was split; one tap per note means no zero-length notes either.
    t.events.forEach((e, i) => expect(e.kind === 'rest' && t.events[i - 1]?.kind === 'rest').toBe(false));
  }
  expect(score.tracks.reduce((s, t) => s + t.maxPlayers, 0)).toBe(MAX_PLAYERS);
  const melody = score.tracks.find((t) => t.id === 'melody');
  expect(melody).toBeDefined();
  for (const t of score.tracks) expect(melody?.maxPlayers ?? 0).toBeGreaterThanOrEqual(t.maxPlayers);

  expect(report.durationSec).toBeCloseTo((total * 60) / score.bpm, 6);
  expect(report.durationSec).toBeLessThanOrEqual(maxSeconds);
  expect(report.parts.map((p) => p.id)).toEqual(score.tracks.map((t) => t.id));
  for (const p of report.parts) expect(p.notes).toBeGreaterThan(0);
  expect(new Set(score.tracks.map((t) => t.id)).size).toBe(score.tracks.length);
  expect(report.warnings.join(' ')).not.toMatch(/[\u2013\u2014]/);
}

const notesOf = (result: ImportResult, id: string): number[] =>
  result.score.tracks.find((t) => t.id === id)?.events.flatMap((e) => (e.kind === 'note' ? [e.midi] : [])) ?? [];

describe('importMidi', () => {
  it('auto-arranges a bare melody: generated bass and harmony in C major', () => {
    const result = importMidi(melodyOnly());
    invariants(result);
    expect(result.report.key).toBe('C major');
    expect(result.score.tracks.map((t) => t.id)).toEqual(['melody', 'bass', 'harmony-1', 'harmony-2']);
    expect(result.report.warnings.some((w) => w.startsWith('No bass line'))).toBe(true);
    expect(result.report.warnings.some((w) => w.startsWith('No inner voices'))).toBe(true);
    // The tune survives untouched (up to an octave): E E F G G F E D ...
    expect(notesOf(result, 'melody').slice(0, 8).map((m) => m % 12)).toEqual([4, 4, 5, 7, 7, 5, 4, 2]);
    // Generated bass opens on the tonic, and harmony stays diatonic to C.
    expect((notesOf(result, 'bass')[0] ?? -1) % 12).toBe(0);
    const cMajor = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const m of notesOf(result, 'harmony-1')) expect(cMajor.has(m % 12)).toBe(true);
  });

  it('keeps the chord track as harmony and builds a bass from its roots', () => {
    const result = importMidi(melodyAndChords());
    invariants(result);
    expect(result.report.warnings.some((w) => w.startsWith('No bass line'))).toBe(true);
    expect(result.report.warnings.some((w) => w.startsWith('No inner voices'))).toBe(false);
    const bassPcs = new Set(notesOf(result, 'bass').map((m) => m % 12));
    // Roots and fifths of C and G only.
    for (const pc of bassPcs) expect([0, 7, 2].includes(pc)).toBe(true);
    // Harmony lines come from the chord tones in the file.
    for (const id of ['harmony-1', 'harmony-2']) {
      for (const m of notesOf(result, id)) expect([0, 2, 4, 7, 11].includes(m % 12)).toBe(true);
    }
  });

  it('finds melody and bass in a 4-track file and keeps them faithful', () => {
    const result = importMidi(fourTracks());
    invariants(result);
    expect(result.score.title).toBe('Ode to Joy');
    expect(result.report.warnings.some((w) => w.startsWith('No bass line'))).toBe(false);
    const flute = ode('flute').flatMap((e) => (e.kind === 'note' ? [e.midi % 12] : []));
    expect(notesOf(result, 'melody').slice(0, flute.length).map((m) => m % 12)).toEqual(flute);
    const cello = ode('cello').flatMap((e) => (e.kind === 'note' ? [e.midi % 12] : []));
    expect(notesOf(result, 'bass').slice(0, cello.length).map((m) => m % 12)).toEqual(cello);
    const bass = result.score.tracks.find((t) => t.id === 'bass');
    expect(bass?.instrument).toBe('cello');
    expect(new Set(result.score.tracks.map((t) => t.instrument)).size).toBe(4);
  });

  it('turns tempo changes into beats and plays at the first tempo', () => {
    const notes = repeat(eventsToNotes(ode('flute')), 4, ODE_BEATS);
    const buf = writeMidi({
      tempos: [
        { beat: 0, bpm: 90 },
        { beat: 32, bpm: 140 },
        { beat: 64, bpm: 70 },
      ],
      tracks: [{ name: 'Melody', notes }],
    });
    const song = parseMidi(buf);
    expect(song.bpm).toBeCloseTo(90, 3);
    expect(song.tempoChanges).toBe(2);
    // Note starts stay on their beats whatever the tempo.
    const starts = song.voices[0]?.notes.map((n) => n.startBeats) ?? [];
    expect(starts).toEqual(notes.map((n) => n.beat));
    const result = importMidi(buf);
    invariants(result);
    expect(result.score.bpm).toBe(90);
    expect(totalBeats(result.score.tracks[0]?.events ?? [])).toBe(ODE_BEATS * 4);
    expect(result.report.warnings.some((w) => w.includes('changes tempo 2 times'))).toBe(true);
  });

  it('turns a drum track into a pitched rhythm part', () => {
    const melody = repeat(eventsToNotes(ode('flute')), 4, ODE_BEATS);
    const buf = writeMidi({
      tracks: [
        { name: 'Melody', program: 73, notes: melody },
        { name: 'Drums', channel: 9, notes: drumNotes(ODE_BEATS * 4) },
      ],
    });
    expect(parseMidi(buf).voices.some((v) => v.isPercussion)).toBe(true);
    const result = importMidi(buf);
    invariants(result);
    const rhythm = result.score.tracks.find((t) => t.id === 'rhythm');
    expect(rhythm?.instrument).toBe('piano');
    // Kick on the beat, snare on beat two: never faster than eighths.
    for (const e of rhythm?.events ?? []) expect(e.beats).toBeGreaterThanOrEqual(0.5);
    expect(result.report.warnings.some((w) => w.startsWith('No bass line'))).toBe(true);
  });

  it('trims an over-long song to five minutes, ending on a whole bar', () => {
    const buf = writeMidi({ tempos: [{ beat: 0, bpm: 120 }], tracks: [{ name: 'Melody', notes: repeat(eventsToNotes(ode('flute')), 30, ODE_BEATS) }] });
    const result = importMidi(buf);
    invariants(result);
    const beats = totalBeats(result.score.tracks[0]?.events ?? []);
    expect(beats % 4).toBe(0);
    expect(result.report.durationSec).toBeGreaterThan(240);
    // Ode to Joy phrases are 4 bars and end on the tonic or a rest.
    expect(result.report.bars % 4).toBe(0);
    expect(result.report.warnings.some((w) => w.includes('trimmed to the first'))).toBe(true);
    const longer = importMidi(buf, { maxSeconds: 1000 });
    expect(longer.report.durationSec).toBeCloseTo(480, 6);
  });

  it('simplifies a dense part to the event limit', () => {
    const run = Array.from({ length: 2400 }, (_, i) => ({ midi: 72 + ((i * 5) % 12), beat: i / 4, dur: 0.25 }));
    const result = importMidi(writeMidi({ tempos: [{ beat: 0, bpm: 120 }], tracks: [{ name: 'Melody', notes: run }] }));
    invariants(result);
    expect(result.report.warnings.some((w) => w.startsWith('Flute: simplified'))).toBe(true);
  });

  it('splits one polyphonic piano track into melody and a playable bass', () => {
    const rightHand = repeat(eventsToNotes(ode('flute'), 0, 12), 4, ODE_BEATS);
    // Alberti figure C G E G in sixteenths: a pianist's left hand, not a phone part.
    const alberti = Array.from({ length: ODE_BEATS * 4 * 4 }, (_, i) => ({ midi: [48, 55, 52, 55][i % 4] ?? 48, beat: i / 4, dur: 0.25, vel: 60 }));
    const result = importMidi(writeMidi({ tracks: [{ name: 'Piano', program: 0, notes: [...rightHand, ...alberti] }] }));
    invariants(result);
    expect(result.report.warnings.some((w) => w.startsWith('No bass line'))).toBe(false);
    const melody = notesOf(result, 'melody').slice(0, 4).map((m) => m % 12);
    expect(melody).toEqual([4, 4, 5, 7]);
    const bass = result.score.tracks.find((t) => t.id === 'bass');
    const bassNotes = bass?.events.filter((e) => e.kind === 'note').length ?? 0;
    expect(bassNotes).toBeLessThanOrEqual(ODE_BEATS * 4 * 1.5);
  });

  it('respects maxParts, a long title and percussion-only files', () => {
    const one = importMidi(fourTracks(), { maxParts: 1, title: 'x'.repeat(200) });
    invariants(one);
    expect(one.score.tracks.map((t) => t.id)).toEqual(['melody']);
    expect(one.score.tracks[0]?.maxPlayers).toBe(MAX_PLAYERS);
    expect(one.score.title).toHaveLength(MAX_TITLE_LEN);
    const drumsOnly = writeMidi({ tracks: [{ channel: 9, notes: drumNotes(16) }] });
    expect(() => importMidi(drumsOnly)).toThrow(/no pitched notes/);
    expect(() => importMidi(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/not a readable MIDI file/);
  });

  it('is deterministic for the same bytes', () => {
    for (const make of [melodyOnly, melodyAndChords, fourTracks]) {
      const a = importMidi(make());
      const b = importMidi(make());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe('parse', () => {
  it('detects triplet feel and quantises to triplet eighths', () => {
    const triplets = Array.from({ length: 48 }, (_, i) => i / 3);
    expect(hasTripletFeel(triplets)).toBe(true);
    expect(hasTripletFeel(Array.from({ length: 48 }, (_, i) => i / 4))).toBe(false);
    const buf = writeMidi({ tracks: [{ notes: triplets.map((beat, i) => ({ midi: 60 + (i % 5), beat: beat + 0.02, dur: 0.3 })) }] });
    const song = parseMidi(buf);
    expect(song.gridBeats).toBeCloseTo(1 / 3, 9);
    for (const n of song.voices[0]?.notes ?? []) {
      expect(n.startBeats * 3 - Math.round(n.startBeats * 3)).toBeCloseTo(0, 6);
      expect(n.durationBeats).toBeCloseTo(1 / 3, 6);
    }
    invariants(importMidi(buf));
  });

  it('drops notes shorter than a thirty-second and keeps short ones on the grid', () => {
    const out = quantise(
      [
        { midi: 60, startBeats: 0.01, durationBeats: 0.05, velocity: 90 },
        { midi: 62, startBeats: 0.49, durationBeats: 0.13, velocity: 90 },
        { midi: 64, startBeats: 1.02, durationBeats: 0.98, velocity: 90 },
      ],
      0.25,
    );
    expect(out.map((n) => [n.midi, n.startBeats, n.durationBeats])).toEqual([
      [62, 0.5, 0.25],
      [64, 1, 1],
    ]);
  });

  it('reads time signature, names, programs and the drum channel', () => {
    const buf = writeMidi({
      name: 'Waltz',
      timeSignature: [3, 4],
      tracks: [
        { name: 'Violin', program: 40, notes: [{ midi: 67, beat: 0, dur: 3 }] },
        { name: 'Kit', channel: 9, notes: [{ midi: 36, beat: 0, dur: 0.5 }] },
      ],
    });
    const song = parseMidi(buf);
    expect(song.name).toBe('Waltz');
    expect(song.beatsPerBar).toBe(3);
    expect(song.voices.map((v) => [v.name, v.program, v.isPercussion])).toEqual([
      ['Violin', 40, false],
      ['Kit', 0, true],
    ]);
  });
});

const sn = (midi: number, start: number, end: number): StepNote => ({ midi, start, end, velocity: 80 });

describe('lines', () => {
  it('skyline keeps the top voice, bottomline the lowest', () => {
    const chordal = [sn(60, 0, 8), sn(64, 0, 8), sn(72, 0, 4), sn(74, 4, 8), sn(62, 2, 4)];
    expect(skyline(chordal).map((n) => [n.midi, n.start, n.end])).toEqual([
      [72, 0, 4],
      [74, 4, 8],
    ]);
    expect(bottomline(chordal).map((n) => [n.midi, n.start, n.end])).toEqual([[60, 0, 8]]);
  });

  it('lines never overlap', () => {
    const notes = Array.from({ length: 200 }, (_, i) => sn(40 + ((i * 7) % 40), (i * 3) % 97, ((i * 3) % 97) + 1 + (i % 9)));
    for (const line of [skyline(notes), bottomline(notes), thinToCells(skyline(notes), 4, 'lowest')]) {
      line.forEach((n, i) => {
        expect(n.end).toBeGreaterThan(n.start);
        const next = line[i + 1];
        if (next) expect(next.start).toBeGreaterThanOrEqual(n.end);
      });
    }
  });

  it('fits a line with one octave shift and folds only strays', () => {
    const fit = fitRange([sn(40, 0, 1), sn(45, 1, 2), sn(52, 2, 3), sn(30, 3, 4)], INSTRUMENT_RANGE.flute);
    expect(fit.shift).toBe(24);
    expect(fit.line.map((n) => n.midi)).toEqual([64, 69, 76, 66]);
    expect(fit.folded).toBe(1);
  });

  it('simplify thins until the event budget fits', () => {
    const grid = { stepsPerBeat: 4, barSteps: 16, windowSteps: 8 };
    const busy = Array.from({ length: 400 }, (_, i) => sn(60 + (i % 7), i, i + 1));
    const simple = simplify(busy, 120, 400, grid);
    expect(eventCount(simple, 400)).toBeLessThanOrEqual(120);
    expect(simple[0]?.start).toBe(0);
  });

  it('sections add up to a full room with the melody largest', () => {
    expect(sectionSizes(['melody', 'bass', 'harmony', 'harmony'])).toEqual([31, 23, 23, 23]);
    expect(sectionSizes(['melody', 'bass', 'harmony', 'rhythm', 'harmony']).reduce((a, b) => a + b)).toBe(100);
  });

  it('cleans titles', () => {
    expect(cleanTitle('  Minuet\n\tin G  ')).toBe('Minuet in G');
    expect(cleanTitle('')).toBe('Imported song');
  });
});

describe('theory', () => {
  it('detects keys from pitch-class weight', () => {
    const g = [7, 9, 11, 0, 2, 4, 6];
    const hist = new Array<number>(12).fill(0);
    g.forEach((pc, i) => (hist[pc] = i === 0 ? 4 : i === 4 ? 3 : 1));
    expect(detectKey(hist).name).toBe('G major');
    const a = [9, 11, 0, 2, 4, 5, 8];
    const minor = new Array<number>(12).fill(0);
    a.forEach((pc, i) => (minor[pc] = i === 0 ? 4 : i === 2 || i === 4 ? 3 : 1));
    expect(detectKey(minor).name).toBe('A minor');
  });

  it('picks the chord that covers the sounding notes', () => {
    const key = keyInfo(0, 'major');
    const hist = new Array<number>(12).fill(0);
    hist[7] = 2;
    hist[11] = 1;
    hist[2] = 1;
    const chord = pickChord(hist, { key, candidates: keyChords(key), previous: undefined, bassPc: 7 });
    expect(chord?.root).toBe(7);
  });

  it('walks the scale for thirds and sixths', () => {
    const c = keyInfo(0, 'major').scale;
    expect(scaleStep(64, -2, c)).toBe(60);
    expect(scaleStep(64, -5, c)).toBe(55);
    expect(scaleStep(61, -2, c)).toBe(57);
  });
});
