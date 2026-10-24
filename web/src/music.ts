import type { InstrumentId } from '@kilukkam/shared';

// Pure music helpers. No WebAudio or DOM in here so tests run in node.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Equal temperament, A4 (MIDI 69) = 440 Hz */
export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12);
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
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentMeta> = {
  violin: { label: 'Violin', emoji: '🎻', color: 'var(--violin)' },
  cello: { label: 'Cello', emoji: '🎻', color: 'var(--cello)' },
  flute: { label: 'Flute', emoji: '🪈', color: 'var(--flute)' },
  piano: { label: 'Piano', emoji: '🎹', color: 'var(--piano)' },
};

export function instrumentMeta(id: string): InstrumentMeta {
  return (INSTRUMENTS as Record<string, InstrumentMeta | undefined>)[id] ?? {
    label: id,
    emoji: '🎵',
    color: 'var(--accent)',
  };
}
