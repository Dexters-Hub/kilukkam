import { describe, expect, it } from 'vitest';
import { PIECES } from '../../shared/src/pieces/index.js';
import { furElise, furEliseHarmony } from '../../shared/src/pieces/fur-elise.js';
import { greensleeves, greensleevesHarmony } from '../../shared/src/pieces/greensleeves.js';
import { mountainKing, mountainKingHarmony } from '../../shared/src/pieces/mountain-king.js';
import { odeToJoy, odeToJoyHarmony } from '../../shared/src/pieces/ode-to-joy.js';
import { harmonySpans, pc } from '../../shared/src/pieces/originals/notation.js';
import { spanishRomance, spanishRomanceHarmony } from '../../shared/src/pieces/spanish-romance.js';
import { totalBeats, validateScore, type Score, type ScoreEvent, type Track } from '../../shared/src/score.js';
import { BANK_NOTES } from '../src/lib/samples.js';

// The public domain arrangements with a fingerstyle guitar part. Each piece
// is held to its harmony plan: on every downbeat the melody, the guitar and
// the cello agree on the chord, so the room actually sounds in harmony.

/** Triplets are written as thirds of a beat, so positions are compared with a little slack. */
const EPS = 1e-6;

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

interface Case {
  score: Score;
  plan: readonly string[];
  /** The part that carries the tune */
  melody: string;
  /** 'bass': the guitar accompanies, its downbeat is the chord's bass; 'melody': the guitar carries the tune */
  guitar: 'bass' | 'melody';
  /** Ode to Joy is a short warm-up; the new pieces run a minute or two */
  seconds?: readonly [number, number];
}

const CASES: readonly Case[] = [
  { score: odeToJoy, plan: odeToJoyHarmony, melody: 'flute', guitar: 'bass' },
  { score: spanishRomance, plan: spanishRomanceHarmony, melody: 'violin', guitar: 'melody', seconds: [60, 120] },
  { score: greensleeves, plan: greensleevesHarmony, melody: 'flute', guitar: 'bass', seconds: [60, 120] },
  { score: mountainKing, plan: mountainKingHarmony, melody: 'violin', guitar: 'bass', seconds: [60, 120] },
  { score: furElise, plan: furEliseHarmony, melody: 'piano', guitar: 'bass', seconds: [60, 120] },
];

describe.each(CASES.map((c) => [c.score.title, c] as const))('%s', (_title, { score, plan, melody, guitar, seconds }) => {
  const spans = harmonySpans(plan, score.beatsPerBar);
  const chordAt = (beat: number) => spans.find((s) => s.at <= beat + EPS && beat + EPS < s.at + s.beats)?.chord;
  const length = plan.length * score.beatsPerBar;
  const sounding = (id: string, beat: number) => notesOf(track(score, id).events).find((n) => n.at <= beat + EPS && beat + EPS < n.end);

  it('validates and is in the piece library', () => {
    expect(validateScore(score)).toEqual([]);
    expect(PIECES).toContain(score);
  });

  it('has a fingerstyle guitar part', () => {
    expect(track(score, 'guitar')).toMatchObject({ name: 'Guitar', instrument: 'guitar' });
  });

  it('runs every part exactly as long as the harmony plan', () => {
    for (const t of score.tracks) expect(totalBeats(t.events), t.id).toBeCloseTo(length, 6);
  });

  if (seconds) {
    it(`lasts ${seconds[0]} to ${seconds[1]} seconds`, () => {
      const s = (length * 60) / score.bpm;
      expect(s).toBeGreaterThanOrEqual(seconds[0]);
      expect(s).toBeLessThanOrEqual(seconds[1]);
    });
  }

  it('is playable one tap at a time: whole MIDI notes, none faster than a tap', () => {
    for (const t of score.tracks) {
      for (const e of t.events) {
        if (e.kind !== 'note') continue;
        expect(Number.isInteger(e.midi), t.id).toBe(true);
        expect((e.beats * 60) / score.bpm, `${t.id} note length`).toBeGreaterThanOrEqual(0.19);
      }
    }
  });

  it('keeps every part in range: recorded parts near a sample, guitar E2 to C6, drums on GM keys', () => {
    for (const t of score.tracks) {
      const bank = BANK_NOTES[t.instrument];
      const [lo, hi] = t.instrument === 'guitar' ? [40, 84] : t.instrument === 'drums' ? [35, 57] : [Math.min(...bank) - 3, Math.max(...bank) + 3];
      const pitches = notesOf(t.events).map((n) => n.midi);
      expect(Math.min(...pitches), `${t.id} lowest`).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...pitches), `${t.id} highest`).toBeLessThanOrEqual(hi);
    }
  });

  it('seats at most 100 players', () => {
    expect(score.tracks.reduce((n, t) => n + t.maxPlayers, 0)).toBeLessThanOrEqual(100);
  });

  it('agrees on the chord on every downbeat: melody, guitar and cello', () => {
    const wrong: string[] = [];
    for (let bar = 0; bar < plan.length; bar++) {
      const beat = bar * score.beatsPerBar;
      const chord = chordAt(beat);
      if (!chord) throw new Error(`no chord at bar ${bar + 1}`);
      const tune = sounding(melody, beat);
      if (tune && !chord.tones.includes(pc(tune.midi))) wrong.push(`bar ${bar + 1}: ${melody} ${tune.midi} over ${chord.symbol}`);
      const g = sounding('guitar', beat);
      if (!g || Math.abs(g.at - beat) > EPS) wrong.push(`bar ${bar + 1}: the guitar does not pluck on the downbeat`);
      else if (guitar === 'bass' ? pc(g.midi) !== chord.bass : !chord.tones.includes(pc(g.midi))) wrong.push(`bar ${bar + 1}: guitar ${g.midi} over ${chord.symbol}`);
      const bass = sounding('cello', beat);
      if (bass && !chord.tones.includes(pc(bass.midi))) wrong.push(`bar ${bar + 1}: cello ${bass.midi} over ${chord.symbol}`);
    }
    expect(wrong).toEqual([]);
  });

  if (guitar === 'bass') {
    it('builds the guitar part only from chord tones', () => {
      for (const n of notesOf(track(score, 'guitar').events)) {
        expect(chordAt(n.at)?.tones, `guitar ${n.midi} at beat ${n.at}`).toContain(pc(n.midi));
      }
    });
  }
});

describe('Ode to Joy', () => {
  it('seats 20 on each of its five parts', () => {
    expect(odeToJoy.tracks.map((t) => [t.id, t.maxPlayers])).toEqual([
      ['flute', 20],
      ['violin', 20],
      ['piano', 20],
      ['cello', 20],
      ['guitar', 20],
    ]);
  });
});

describe('Romance', () => {
  it('the second time through, the violin doubles the first note of every guitar triplet', () => {
    const half = spanishRomanceHarmony.length / 2;
    const from = half * spanishRomance.beatsPerBar;
    const onBeat = notesOf(track(spanishRomance, 'guitar').events).filter((n) => n.at >= from - EPS && Math.abs(n.at - Math.round(n.at)) < EPS);
    const violin = notesOf(track(spanishRomance, 'violin').events).filter((n) => n.at >= from - EPS);
    expect(violin.map((n) => n.midi)).toEqual(onBeat.filter((n) => violin.some((v) => Math.abs(v.at - n.at) < EPS)).map((n) => n.midi));
    expect(violin.length).toBe(half * 3 - 2);
  });
});

describe('In the Hall of the Mountain King', () => {
  it('speeds up by note value: the theme in quarters, then in eighths', () => {
    const starts = notesOf(track(mountainKing, 'cello').events);
    const inBars = (from: number, to: number) => starts.filter((n) => n.at >= (from - 1) * 4 && n.at < (to - 1) * 4).length;
    // The first eight bars of the creep hold the first four bars of the theme.
    expect(inBars(17, 21)).toBe(inBars(1, 9));
    expect(inBars(17, 21) / 4).toBe(2 * (inBars(1, 9) / 8));
  });

  it('has a drum part', () => {
    expect(track(mountainKing, 'drums').instrument).toBe('drums');
  });
});
