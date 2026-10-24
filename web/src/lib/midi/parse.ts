import tonejs from '@tonejs/midi';

// @tonejs/midi ships CommonJS; both Vite and Node expose it as the default export.
const { Midi } = tonejs;

// MIDI file to a normalised song: every time is in quarter-note beats (so
// tempo changes vanish into musical time), notes sit on a grid, and each
// MIDI track and channel is one voice.

export interface ParsedNote {
  midi: number;
  startBeats: number;
  durationBeats: number;
  /** 1 to 127 */
  velocity: number;
}

export interface ParsedVoice {
  name: string;
  /** General MIDI program, 0 to 127 */
  program: number;
  /** 0-based MIDI channel; 9 is the General MIDI drum channel (channel 10) */
  channel: number;
  isPercussion: boolean;
  notes: ParsedNote[];
}

export interface ParsedSong {
  name: string;
  /** The first tempo in the file */
  bpm: number;
  /** How many later tempo events change the speed */
  tempoChanges: number;
  timeSignature: { numerator: number; denominator: number };
  /** Bar length in quarter-note beats (6/8 is 3) */
  beatsPerBar: number;
  /** Quantisation step in beats: 0.25 (sixteenths) or 1/3 (eighth triplets) */
  gridBeats: number;
  voices: ParsedVoice[];
}

export const DEFAULT_BPM = 120;
const SIXTEENTH = 1 / 4;
const TRIPLET_EIGHTH = 1 / 3;
const THIRTY_SECOND = 1 / 8;
/** Share of onsets on triplet-only positions that switches the grid to triplets */
const TRIPLET_SHARE = 0.3;
const DRUM_CHANNEL = 9;

/** True when enough onsets sit on a third or two thirds of a beat, where no sixteenth lies. */
export function hasTripletFeel(onsetBeats: readonly number[]): boolean {
  if (onsetBeats.length === 0) return false;
  const tolerance = 1 / 24;
  const onTriplet = onsetBeats.filter((b) => {
    const frac = b - Math.floor(b);
    return Math.abs(frac - 1 / 3) < tolerance || Math.abs(frac - 2 / 3) < tolerance;
  }).length;
  return onTriplet / onsetBeats.length > TRIPLET_SHARE;
}

/**
 * Snap starts and lengths to the grid. A note that rounds to nothing keeps
 * one step when it was at least a thirty-second long, else it is dropped
 * (grace notes and MIDI glitches).
 */
export function quantise(notes: readonly ParsedNote[], gridBeats: number): ParsedNote[] {
  const out: ParsedNote[] = [];
  for (const n of notes) {
    const start = Math.max(0, Math.round(n.startBeats / gridBeats));
    let steps = Math.round(n.durationBeats / gridBeats);
    if (steps === 0) {
      if (n.durationBeats < THIRTY_SECOND) continue;
      steps = 1;
    }
    out.push({ ...n, startBeats: start * gridBeats, durationBeats: steps * gridBeats });
  }
  return out.sort((a, b) => a.startBeats - b.startBeats || a.midi - b.midi);
}

const countTempoChanges = (bpms: readonly number[]): number =>
  bpms.reduce((count, bpm, i) => (i > 0 && Math.round(bpm) !== Math.round(bpms[i - 1] ?? bpm) ? count + 1 : count), 0);

export function parseMidi(buf: ArrayBuffer): ParsedSong {
  let midi: InstanceType<typeof Midi>;
  try {
    midi = new Midi(buf);
  } catch {
    throw new Error('This file is not a readable MIDI file.');
  }
  const ppq = midi.header.ppq;
  if (!(ppq > 0)) throw new Error('This MIDI file has no timing information.');

  const tempos = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks).map((t) => t.bpm);
  const firstTempo = tempos[0];
  const bpm = firstTempo !== undefined && firstTempo > 0 ? firstTempo : DEFAULT_BPM;

  const sig = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)[0]?.timeSignature;
  const numerator = sig?.[0] ?? 4;
  const denominator = sig?.[1] ?? 4;

  const raw = midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t, i) => ({
      name: t.name.trim() || t.instrument.name || `Track ${i + 1}`,
      program: t.instrument.number,
      channel: t.channel,
      isPercussion: t.channel === DRUM_CHANNEL || t.instrument.percussion,
      notes: t.notes.map((n) => ({
        midi: n.midi,
        startBeats: n.ticks / ppq,
        durationBeats: n.durationTicks / ppq,
        velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
      })),
    }));

  const gridBeats = hasTripletFeel(raw.flatMap((v) => v.notes.map((n) => n.startBeats))) ? TRIPLET_EIGHTH : SIXTEENTH;

  return {
    name: midi.header.name.trim(),
    bpm,
    tempoChanges: countTempoChanges(tempos),
    timeSignature: { numerator, denominator },
    beatsPerBar: (numerator * 4) / denominator,
    gridBeats,
    voices: raw
      .map((v) => ({ ...v, notes: quantise(v.notes, gridBeats) }))
      .filter((v) => v.notes.length > 0),
  };
}
