import { describe, expect, it } from 'vitest';
import { beatsToSeconds, midiToFreq, noteName } from '../src/music.js';

describe('midiToFreq', () => {
  it('maps A4 to 440 Hz', () => {
    expect(midiToFreq(69)).toBe(440);
  });
  it('doubles per octave', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });
  it('gives middle C ≈ 261.63 Hz', () => {
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });
  it('respects a custom A4', () => {
    expect(midiToFreq(69, 432)).toBe(432);
  });
});

describe('noteName', () => {
  it('names scientific pitch', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(78)).toBe('F#5');
    expect(noteName(42)).toBe('F#2');
    expect(noteName(21)).toBe('A0');
  });
});

describe('beatsToSeconds', () => {
  it('converts beats at a tempo', () => {
    expect(beatsToSeconds(1, 60)).toBe(1);
    expect(beatsToSeconds(2, 120)).toBe(1);
    expect(beatsToSeconds(1, 0)).toBe(0);
  });
});
