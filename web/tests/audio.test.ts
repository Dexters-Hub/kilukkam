import type { InstrumentId } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { noteSeconds, renderNote } from '../src/lib/audio.js';

// A minimal stand-in for BaseAudioContext: enough surface for the voices,
// and it records how often every source is started and stopped. WebAudio
// throws if a source starts twice, which once silenced every bowed note.

const param = () => ({
  value: 0,
  setValueAtTime: () => {},
  linearRampToValueAtTime: () => {},
  exponentialRampToValueAtTime: () => {},
  setTargetAtTime: () => {},
});

const fakeContext = () => {
  const sources: { starts: number; stops: number }[] = [];
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const source = () => {
    const rec = { starts: 0, stops: 0 };
    sources.push(rec);
    return {
      ...node(),
      frequency: param(),
      detune: param(),
      type: 'sine',
      buffer: null,
      loop: false,
      onended: null,
      start: () => {
        rec.starts++;
        if (rec.starts > 1) throw new Error('InvalidStateError: start called twice');
      },
      stop: () => {
        rec.stops++;
      },
    };
  };
  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: source,
    createBufferSource: source,
    createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources };
};

describe('voices', () => {
  const instruments: InstrumentId[] = ['violin', 'cello', 'flute', 'piano'];
  it.each(instruments)('%s starts and stops every source exactly once', (instrument) => {
    const { ctx, sources } = fakeContext();
    const dest = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;
    expect(() => renderNote(ctx, dest, instrument, 69, 1, 100, 0)).not.toThrow();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(s).toEqual({ starts: 1, stops: 1 });
  });
});

describe('noteSeconds', () => {
  it('follows the score, clamped to a playable range', () => {
    expect(noteSeconds(1, 60)).toBe(1);
    expect(noteSeconds(0.01, 120)).toBe(0.12);
    expect(noteSeconds(16, 60)).toBe(4);
  });
});
