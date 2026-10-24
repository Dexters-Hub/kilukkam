import type { InstrumentId } from '@kilukkam/shared';

// Pure music helpers. No WebAudio or DOM in here so tests run in node.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Equal temperament, A4 (MIDI 69) = 440 Hz */
export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

const DRUM_HITS: Record<number, string> = { 35: 'Kick', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare', 41: 'Tom', 42: 'Hat', 43: 'Tom', 44: 'Hat', 45: 'Tom', 46: 'Open', 47: 'Tom', 48: 'Tom', 49: 'Crash', 50: 'Tom', 57: 'Crash' };

/** What a player sees for a note: a pitch name, or for the drum kit the drum it hits. */
export function hitName(instrument: string, midi: number): string {
  return instrument === 'drums' ? (DRUM_HITS[Math.round(midi)] ?? 'Hit') : noteName(midi);
}

/** 60 → "C4", 78 → "F#5" (scientific pitch, middle C = C4) */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  return `${NAMES[pc] ?? '?'}${Math.floor(m / 12) - 1}`;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return bpm > 0 ? (beats * 60) / bpm : 0;
}

export interface InstrumentMeta {
  label: string;
  emoji: string;
  /** CSS custom property holding this instrument's tint */
  color: string;
  /** How it sounds, in three words or so */
  blurb: string;
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentMeta> = {
  violin: { label: 'Violin', emoji: '🎻', color: 'var(--violin)', blurb: 'Bright and singing' },
  cello: { label: 'Cello', emoji: '🎻', color: 'var(--cello)', blurb: 'Deep and warm' },
  flute: { label: 'Flute', emoji: '🪈', color: 'var(--flute)', blurb: 'Airy and sweet' },
  piano: { label: 'Piano', emoji: '🎹', color: 'var(--piano)', blurb: 'Crisp and bright' },
  drums: { label: 'Drums', emoji: '🥁', color: 'var(--drums)', blurb: 'Punchy and tight' },
  guitar: { label: 'Guitar', emoji: '🎸', color: 'var(--guitar)', blurb: 'Warm fingerstyle' },
};

export function instrumentMeta(id: string): InstrumentMeta {
  return (INSTRUMENTS as Record<string, InstrumentMeta | undefined>)[id] ?? {
    label: id,
    emoji: '🎵',
    color: 'var(--accent)',
    blurb: '',
  };
}
