import { getPiece } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { Recorder, channelGains, defaultMix, encodeMidi, encodeWav, fillGaps, takeFileName, takeLength, takeNotes, vlq } from '../src/lib/recording.js';
import { onsets } from '../src/lib/rhythm.js';

const ode = getPiece('ode-to-joy');
if (!ode) throw new Error('ode-to-joy missing');

describe('Recorder', () => {
  it('timestamps echoes relative to the start and ignores them before start', () => {
    const r = new Recorder();
    r.add({ trackId: 'flute', playerId: 'a', noteIndex: 0 }, 500);
    expect(r.current).toBeNull();
    r.start('ode-to-joy', 1000);
    r.add({ trackId: 'flute', playerId: 'a', noteIndex: 0 }, 1600);
    expect(r.current?.events).toEqual([{ trackId: 'flute', playerId: 'a', noteIndex: 0, t: 0.6 }]);
  });
  it('a new start replaces the old take (encore)', () => {
    const r = new Recorder();
    r.start('ode-to-joy', 0);
    r.add({ trackId: 'flute', playerId: 'a', noteIndex: 0 }, 10);
    r.start('ode-to-joy', 100);
    expect(r.current).toBeNull();
  });
});

describe('mix', () => {
  it('mute silences, solo isolates, gain clamps', () => {
    const mix = defaultMix(ode);
    expect(Object.values(channelGains(mix)).every((g) => g === 1)).toBe(true);
    mix.flute = { gain: 9, muted: false, solo: false };
    mix.cello = { gain: 1, muted: true, solo: false };
    expect(channelGains(mix)).toMatchObject({ flute: 1.5, cello: 0 });
    mix.violin = { gain: 0.5, muted: false, solo: true };
    expect(channelGains(mix)).toEqual({ flute: 0, violin: 0.5, piano: 0, cello: 0, guitar: 0 });
  });
});

describe('takeNotes', () => {
  const take = {
    pieceId: 'ode-to-joy',
    events: [
      { t: 0.6, trackId: 'violin', playerId: 'b', noteIndex: 0 },
      { t: 0, trackId: 'flute', playerId: 'a', noteIndex: 0 },
      { t: 0.01, trackId: 'flute', playerId: 'c', noteIndex: 0 },
      { t: 1, trackId: 'flute', playerId: 'a', noteIndex: 999 },
    ],
  };
  it('maps echoes to score notes in time order and drops bad indices', () => {
    const notes = takeNotes(ode, take, defaultMix(ode));
    expect(notes.map((n) => [n.trackId, n.midi])).toEqual([['flute', 64], ['flute', 64], ['violin', 60]]);
  });
  it('softens a crowded part and skips muted ones', () => {
    const mix = defaultMix(ode);
    const notes = takeNotes(ode, take, mix);
    expect(notes[0]?.level).toBeCloseTo(1 / Math.SQRT2);
    mix.violin = { gain: 1, muted: true, solo: false };
    expect(takeNotes(ode, take, mix).some((n) => n.trackId === 'violin')).toBe(false);
  });
  it('length covers the last note plus release', () => {
    const notes = takeNotes(ode, take, defaultMix(ode));
    expect(takeLength(notes, ode.bpm)).toBeCloseTo(0.6 + 60 / ode.bpm + 2.5);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo header and clamps samples', () => {
    const buf = encodeWav([new Float32Array([0, 1, -2]), new Float32Array([0.5, 0, 0])], 44100);
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(3 * 4);
    expect(v.getInt16(44 + 4, true)).toBe(0x7fff);
    expect(v.getInt16(44 + 8, true)).toBe(-0x8000);
  });
});

describe('MIDI', () => {
  it('encodes variable-length quantities', () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(127)).toEqual([0x7f]);
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f]);
  });
  it('writes a format-1 file with a tempo track plus one track per part', () => {
    const notes = takeNotes(ode, { pieceId: 'ode-to-joy', events: [{ t: 0.5, trackId: 'flute', playerId: 'a', noteIndex: 0 }] }, defaultMix(ode));
    const midi = encodeMidi(ode, notes);
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe('MThd');
    expect(midi[9]).toBe(1); // format 1
    expect((midi[10]! << 8) | midi[11]!).toBe(ode.tracks.length + 1);
    const tracks = String.fromCharCode(...midi).split('MTrk').length - 1;
    expect(tracks).toBe(ode.tracks.length + 1);
    // flute note-on (E4 = 64) appears after 0.5 s = 480 ticks at 120 bpm
    const hex = [...midi].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex).toContain('83 60 90 40');
  });
});

describe('takeFileName', () => {
  it('is sortable and filesystem-safe', () => {
    expect(takeFileName('canon-in-d', new Date(2026, 9, 24, 21, 5), 'wav')).toBe('kilukkam-canon-in-d-2026-10-24-2105.wav');
  });
});

describe('fillGaps', () => {
  const part = ode.tracks[0]!;
  const beats = onsets(part.events);
  const notes = part.events.map((e, i) => ({ e, i })).filter((x) => x.e.kind === 'note');
  const spb = 60 / ode.bpm;

  it('adds the notes the room missed on its parts, timed from the take', () => {
    // The room played every other note, on time at the written tempo.
    const played = notes.filter((_, k) => k % 2 === 0);
    const take = { pieceId: ode.id, events: played.map(({ i }) => ({ trackId: part.id, playerId: 'a', noteIndex: i, t: (beats[i] ?? 0) * spb })) };
    const filled = fillGaps(ode, take, ode.bpm);
    expect(filled).toHaveLength(notes.length - played.length);
    // Each filled note lands on the written time of a note the room skipped.
    const skipped = notes.filter((_, k) => k % 2 === 1).map(({ i }) => (beats[i] ?? 0) * spb);
    for (const n of filled) expect(skipped.some((t) => Math.abs(t - n.t) < 1e-6)).toBe(true);
  });

  it('follows the take when the room played slower than written', () => {
    const [a, , c] = notes;
    if (!a || !c) throw new Error('need notes');
    const slow = 2;
    const take = { pieceId: ode.id, events: [a, c].map(({ i }) => ({ trackId: part.id, playerId: 'a', noteIndex: i, t: (beats[i] ?? 0) * spb * slow })) };
    const middle = notes[1]!;
    const filled = fillGaps(ode, take, ode.bpm).find((n) => Math.abs(n.t - (beats[middle.i] ?? 0) * spb * slow) < 1e-6);
    expect(filled).toBeDefined();
  });

  it('leaves parts nobody played silent, and an empty take empty', () => {
    const take = { pieceId: ode.id, events: [{ trackId: part.id, playerId: 'a', noteIndex: notes[0]!.i, t: 0 }] };
    expect(fillGaps(ode, take, ode.bpm).every((n) => n.trackId === part.id)).toBe(true);
    expect(fillGaps(ode, { pieceId: ode.id, events: [] }, ode.bpm)).toEqual([]);
  });
});

