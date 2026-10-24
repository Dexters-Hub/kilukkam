import { describe, expect, it } from 'vitest';
import { HARMONY, ORIGINALS, pixelPlainsDrums } from '../../shared/src/pieces/originals/index.js';
import { bars, harmonySpans, midiOf, pc } from '../../shared/src/pieces/originals/notation.js';
import { totalBeats, validateScore, type Score, type ScoreEvent, type Track } from '../../shared/src/score.js';
import { BANK_NOTES } from '../src/lib/samples.js';
import { arpeggio, drum, drumFor, dutyLevels, lfsrNoise, pulse, stepWaveCoefficients, triangle, TRIANGLE_LEVELS, type ChipBuilt } from '../src/lib/voices/chip.js';

// ---------- helpers ----------

interface Sounding {
  at: number;
  end: number;
  midi: number;
}

const notesOf = (events: readonly ScoreEvent[]): Sounding[] => {
  const out: Sounding[] = [];
  let at = 0;
  for (const e of events) {
    if (e.kind === 'note') out.push({ at, end: at + e.beats, midi: e.midi });
    at += e.beats;
  }
  return out;
};

const track = (score: Score, id: string): Track => {
  const t = score.tracks.find((x) => x.id === id);
  if (!t) throw new Error(`${score.id} has no ${id}`);
  return t;
};

const piece = (id: string): Score => {
  const s = ORIGINALS.find((p) => p.id === id);
  if (!s) throw new Error(`no piece ${id}`);
  return s;
};

const planOf = (score: Score): readonly string[] => HARMONY[score.id] ?? [];

/** Notes starting inside bars [from, to) (1-based bars), as pitches. */
const pitchesIn = (score: Score, id: string, from: number, to: number): number[] =>
  notesOf(track(score, id).events)
    .filter((n) => n.at >= (from - 1) * score.beatsPerBar && n.at < (to - 1) * score.beatsPerBar)
    .map((n) => n.midi);

// ---------- the pieces ----------

describe.each(ORIGINALS.map((s) => [s.title, s] as const))('%s', (_title, score) => {
  const plan = planOf(score);
  const spans = harmonySpans(plan, score.beatsPerBar);
  const chordAt = (beat: number) => spans.find((s) => s.at <= beat && beat < s.at + s.beats)?.chord;

  it('validates', () => {
    expect(validateScore(score)).toEqual([]);
  });

  it('lasts 2 to 4 minutes', () => {
    const seconds = (totalBeats(track(score, 'violin').events) * 60) / score.bpm;
    expect(seconds).toBeGreaterThanOrEqual(120);
    expect(seconds).toBeLessThanOrEqual(240);
  });

  it('has the four instruments, every part as long as the harmony plan', () => {
    expect(score.tracks.map((t) => t.instrument).sort()).toEqual(['cello', 'flute', 'piano', 'violin']);
    for (const t of score.tracks) expect(totalBeats(t.events), t.id).toBe(plan.length * score.beatsPerBar);
  });

  it('is playable one tap at a time: whole MIDI notes, none faster than a tap', () => {
    for (const t of score.tracks) {
      for (const e of t.events) {
        if (e.kind !== 'note') continue;
        expect(Number.isInteger(e.midi), t.id).toBe(true);
        expect((e.beats * 60) / score.bpm, `${t.id} note length`).toBeGreaterThanOrEqual(0.19);
      }
    }
  });

  it('keeps every part inside its instrument\'s recorded range', () => {
    for (const t of score.tracks) {
      const bank = BANK_NOTES[t.instrument];
      const pitches = notesOf(t.events).map((n) => n.midi);
      expect(Math.min(...pitches), `${t.id} lowest`).toBeGreaterThanOrEqual(Math.min(...bank));
      expect(Math.max(...pitches), `${t.id} highest`).toBeLessThanOrEqual(Math.max(...bank));
    }
  });

  it('agrees on the chord: on beats 1 and 3 every sounding note is a chord tone', () => {
    const wrong: string[] = [];
    for (const t of score.tracks) {
      const notes = notesOf(t.events);
      for (let beat = 0; beat < plan.length * score.beatsPerBar; beat += 2) {
        const chord = chordAt(beat);
        for (const n of notes) {
          if (n.at <= beat && beat < n.end && !chord?.tones.includes(pc(n.midi))) {
            wrong.push(`${t.id} bar ${Math.floor(beat / score.beatsPerBar) + 1} beat ${(beat % score.beatsPerBar) + 1}: ${n.midi} over ${chord?.symbol}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('puts only chord tones in the bass', () => {
    for (const n of notesOf(track(score, 'cello').events)) {
      expect(chordAt(n.at)?.tones, `cello ${n.midi} at beat ${n.at}`).toContain(pc(n.midi));
    }
  });

  it('ends with an authentic cadence: the dominant, then the tonic it started on', () => {
    const tonic = spans[0]?.chord;
    const last = spans[spans.length - 1]?.chord;
    expect(last?.symbol).toBe(tonic?.symbol);
    const before = [...spans].reverse().find((s) => s.chord.symbol !== last?.symbol)?.chord;
    expect(before?.root).toBe(((tonic?.root ?? 0) + 7) % 12);
    expect(pc(notesOf(track(score, 'cello').events).at(-1)?.midi ?? -1)).toBe(tonic?.root);
  });
});

describe('canons and rounds', () => {
  it('Hallowed Depths: the violin plays the flute\'s theme four bars later, an octave down', () => {
    const s = piece('hallowed-depths');
    expect(pitchesIn(s, 'violin', 25, 33)).toEqual(pitchesIn(s, 'flute', 21, 29).map((m) => m - 12));
  });

  it('Boss Rush: the Phase 2 round enters four bars behind the flute, an octave down', () => {
    const s = piece('boss-rush');
    expect(pitchesIn(s, 'violin', 45, 57)).toEqual(pitchesIn(s, 'flute', 41, 53).map((m) => m - 12));
  });

  it('Pixel Plains: the bonus round follows the flute four bars later at pitch', () => {
    const s = piece('pixel-plains');
    expect(pitchesIn(s, 'violin', 41, 49)).toEqual(pitchesIn(s, 'flute', 37, 45));
  });
});

describe('Pixel Plains drums', () => {
  it('last exactly as long as the piece and only use the kick, snare and hat', () => {
    const s = piece('pixel-plains');
    expect(totalBeats(pixelPlainsDrums)).toBe(totalBeats(track(s, 'flute').events));
    const hits = new Set(notesOf(pixelPlainsDrums).map((n) => drumFor(n.midi)));
    expect([...hits].sort()).toEqual(['hat', 'kick', 'snare']);
  });
});

describe('notation', () => {
  it('reads note names with middle C as C4', () => {
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('F#5')).toBe(78);
    expect(midiOf('Bb3')).toBe(58);
  });

  it('parses bars and refuses a bar of the wrong length', () => {
    expect(bars('C4:1 r:3', 90)).toEqual([{ kind: 'note', midi: 60, beats: 1, velocity: 90 }, { kind: 'rest', beats: 3 }]);
    expect(() => bars('C4:1 D4:1 | E4:4')).toThrow(/bar 1/);
    expect(() => bars('H4:4')).toThrow(/bad token/);
  });
});

// ---------- the chip voices ----------

// The same stand-in for BaseAudioContext as audio.test.ts, plus the two
// calls the chip voices add (PeriodicWave and setPeriodicWave). It records
// every source so a source that is never returned (and so never started)
// fails the test as surely as one started twice.

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
      setPeriodicWave: () => {},
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
    createPeriodicWave: () => ({}),
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources };
};

const dest = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;

/** Start and stop like audio.ts's renderNote does. */
const play = (v: ChipBuilt, t0: number) => {
  for (const s of v.sources) {
    s.start(t0);
    s.stop(v.end);
  }
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const VOICES: [string, (c: BaseAudioContext, hold: number) => ChipBuilt][] = [
  ['pulse 12.5%', (c, hold) => pulse(c, dest, 440, 0, hold, 0.3, 0.125)],
  ['pulse 25%', (c, hold) => pulse(c, dest, 440, 0, hold, 0.3, 0.25)],
  ['pulse 50%', (c, hold) => pulse(c, dest, 440, 0, hold, 0.3, 0.5)],
  ['triangle', (c, hold) => triangle(c, dest, 110, 0, hold, 0.3)],
  ['kick', (c, hold) => drum(c, dest, hz(36), 0, hold, 0.3)],
  ['snare', (c, hold) => drum(c, dest, hz(38), 0, hold, 0.3)],
  ['hat', (c, hold) => drum(c, dest, hz(42), 0, hold, 0.3)],
  ['open hat', (c, hold) => drum(c, dest, hz(46), 0, hold, 0.3)],
  ['arpeggio', (c, hold) => arpeggio(c, dest, 262, 0, hold, 0.3, [0, 4, 7])],
];

describe('chip voices', () => {
  it.each(VOICES)('%s starts and stops every source exactly once', (_name, build) => {
    for (const hold of [0.2, 8]) {
      const { ctx, sources } = fakeContext();
      const v = build(ctx, hold);
      expect(() => play(v, 0)).not.toThrow();
      expect(sources.length).toBeGreaterThan(0);
      expect(v.sources.length).toBe(sources.length);
      for (const s of sources) expect(s).toEqual({ starts: 1, stops: 1 });
      expect(Number.isFinite(v.end) && v.end > 0).toBe(true);
      expect(() => v.wobble(1, 0.1)).not.toThrow();
    }
  });

  it('sustains a held pulse or triangle note, while a drum hit stays a one-shot', () => {
    const { ctx } = fakeContext();
    expect(pulse(ctx, dest, 440, 0, 8, 0.3).end).toBeGreaterThanOrEqual(8);
    expect(triangle(ctx, dest, 110, 0, 8, 0.3).end).toBeGreaterThanOrEqual(8);
    expect(drum(ctx, dest, hz(36), 0, 8, 0.3).end).toBeLessThan(1);
  });

  it('maps General MIDI drum numbers onto the kit', () => {
    expect([35, 36, 38, 40, 42, 44, 46].map(drumFor)).toEqual(['kick', 'kick', 'snare', 'snare', 'hat', 'hat', 'open-hat']);
  });
});

describe('chip waveforms', () => {
  const magnitude = (w: { real: Float32Array; imag: Float32Array }, n: number) => Math.hypot(w.real[n] ?? 0, w.imag[n] ?? 0);

  it('builds duty cycles as 8-step sequences', () => {
    expect(dutyLevels(0.125)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(dutyLevels(0.25)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(dutyLevels(0.5)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('a 50% pulse is a square: odd harmonics only, falling as 1/n', () => {
    const w = stepWaveCoefficients(dutyLevels(0.5));
    for (const n of [2, 4, 6]) expect(magnitude(w, n)).toBeLessThan(1e-6);
    expect(magnitude(w, 3) / magnitude(w, 1)).toBeCloseTo(1 / 3, 5);
  });

  it('narrower pulses carry the even harmonics that make them nasal', () => {
    const thin = stepWaveCoefficients(dutyLevels(0.125));
    expect(magnitude(thin, 2) / magnitude(thin, 1)).toBeGreaterThan(0.8);
  });

  it('the stepped triangle is mostly odd harmonics, much softer than a square', () => {
    const w = stepWaveCoefficients(TRIANGLE_LEVELS);
    expect(magnitude(w, 2) / magnitude(w, 1)).toBeLessThan(1e-6);
    expect(magnitude(w, 3) / magnitude(w, 1)).toBeLessThan(0.15);
  });

  it('noise is a two-level shift register; short mode loops every 93 clocks', () => {
    const long = lfsrNoise(4000, false);
    expect(new Set(long)).toEqual(new Set([-1, 1]));
    const short = lfsrNoise(400, true);
    for (let i = 0; i < 300; i++) expect(short[i + 93]).toBe(short[i]);
  });
});
