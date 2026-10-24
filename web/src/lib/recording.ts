import type { InstrumentId, Score } from '@kilukkam/shared';

// The conductor's phone receives every note_echo, so it can keep a take of
// the room's real performance: who played which note, and when. Pure data
// and encoders only; rendering lives in render.ts.

export interface TakeEvent {
  /** Seconds since the piece started, as heard by the conductor */
  t: number;
  trackId: string;
  playerId: string;
  noteIndex: number;
}

export interface Take {
  pieceId: string;
  events: TakeEvent[];
}

export class Recorder {
  private take: Take | null = null;
  private origin = 0;

  start(pieceId: string, nowMs: number): void {
    this.take = { pieceId, events: [] };
    this.origin = nowMs;
  }

  add(e: Omit<TakeEvent, 't'>, nowMs: number): void {
    this.take?.events.push({ ...e, t: Math.max(0, (nowMs - this.origin) / 1000) });
  }

  /** The last take, or null when nothing was played. */
  get current(): Take | null {
    return this.take && this.take.events.length > 0 ? this.take : null;
  }
}

// ---------- mix ----------

export interface Channel {
  /** 0 to 1.5, 1 is unity */
  gain: number;
  muted: boolean;
  solo: boolean;
}

export type Mix = Record<string, Channel>;

export const defaultMix = (score: Score): Mix =>
  Object.fromEntries(score.tracks.map((t) => [t.id, { gain: 1, muted: false, solo: false }]));

/** Effective gain per track: solo wins over everything, mute silences. */
export const channelGains = (mix: Mix): Record<string, number> => {
  const soloing = Object.values(mix).some((c) => c.solo);
  return Object.fromEntries(
    Object.entries(mix).map(([id, c]) => [id, c.muted || (soloing && !c.solo) ? 0 : Math.max(0, Math.min(1.5, c.gain))]),
  );
};

export interface RenderNote {
  t: number;
  trackId: string;
  instrument: InstrumentId;
  midi: number;
  beats: number;
  velocity: number;
  /** Per-note level: track gain, softened when many phones share a part */
  level: number;
}

/** Resolve a take against its score into audible notes, honouring the mix. */
export const takeNotes = (score: Score, take: Take, mix: Mix): RenderNote[] => {
  const gains = channelGains(mix);
  const players = new Map<string, Set<string>>();
  for (const e of take.events) {
    const set = players.get(e.trackId) ?? new Set<string>();
    set.add(e.playerId);
    players.set(e.trackId, set);
  }
  const notes: RenderNote[] = [];
  for (const e of take.events) {
    const track = score.tracks.find((t) => t.id === e.trackId);
    const ev = track?.events[e.noteIndex];
    const gain = gains[e.trackId] ?? 0;
    if (!track || ev?.kind !== 'note' || gain === 0) continue;
    // Ten phones on one part shouldn't be ten times as loud in the file.
    const crowd = 1 / Math.sqrt(players.get(e.trackId)?.size ?? 1);
    notes.push({ t: e.t, trackId: e.trackId, instrument: track.instrument, midi: ev.midi, beats: ev.beats, velocity: ev.velocity ?? 96, level: gain * crowd });
  }
  return notes.sort((a, b) => a.t - b.t);
};

/** Seconds of audio a take needs, including the last note's release. */
export const takeLength = (notes: readonly RenderNote[], bpm: number): number =>
  notes.reduce((end, n) => Math.max(end, n.t + (n.beats * 60) / bpm), 0) + 2.5;

// ---------- WAV ----------

/** 16-bit PCM WAV from planar float channels. */
export const encodeWav = (channels: readonly Float32Array[], sampleRate: number): ArrayBuffer => {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerFrame = numCh * 2;
  const buf = new ArrayBuffer(44 + frames * bytesPerFrame);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + frames * bytesPerFrame, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerFrame, true);
  v.setUint16(32, bytesPerFrame, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, frames * bytesPerFrame, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const x = Math.max(-1, Math.min(1, ch[i] ?? 0));
      v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
};

// ---------- MIDI ----------

const PPQ = 480;
/** Written at 120 bpm so one tick maps to real time: the room's timing survives intact. */
const MIDI_BPM = 120;
const GM_PROGRAM: Record<InstrumentId, number> = { piano: 0, violin: 40, cello: 42, flute: 73, drums: 0, guitar: 24 };

export const vlq = (n: number): number[] => {
  let value = Math.max(0, Math.round(n));
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
};

const secondsToTicks = (s: number): number => Math.round(s * (MIDI_BPM / 60) * PPQ);

/** Standard MIDI File (format 1): a tempo track plus one named track per part. */
export const encodeMidi = (score: Score, notes: readonly RenderNote[]): Uint8Array => {
  const chunk = (type: string, data: number[]) => [...[...type].map((c) => c.charCodeAt(0)), (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data];
  const text = (s: string) => [...new TextEncoder().encode(s)];
  const usPerBeat = Math.round(60_000_000 / MIDI_BPM);
  const tempo = [0, 0xff, 0x51, 3, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255, 0, 0xff, 0x2f, 0];
  const tracks = score.tracks.map((track, i) => {
    // Drums go on GM percussion channel 10 (index 9); every other part skips it.
    const channel = track.instrument === 'drums' ? 9 : i >= 9 ? i + 1 : i;
    const evs: { tick: number; bytes: number[] }[] = [];
    for (const n of notes) {
      if (n.trackId !== track.id) continue;
      const on = secondsToTicks(n.t);
      const off = on + Math.max(1, secondsToTicks((n.beats * 60) / score.bpm));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity * Math.min(1, n.level * 1.2))));
      evs.push({ tick: on, bytes: [0x90 | channel, n.midi, vel] }, { tick: off, bytes: [0x80 | channel, n.midi, 0] });
    }
    evs.sort((a, b) => a.tick - b.tick || (a.bytes[0]! & 0xf0) - (b.bytes[0]! & 0xf0));
    const name = text(track.name);
    const data = [0, 0xff, 0x03, ...vlq(name.length), ...name, 0, 0xc0 | channel, GM_PROGRAM[track.instrument]];
    let last = 0;
    for (const e of evs) {
      data.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    data.push(0, 0xff, 0x2f, 0);
    return chunk('MTrk', data);
  });
  const header = chunk('MThd', [0, 1, 0, tracks.length + 1, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...chunk('MTrk', tempo), ...tracks.flat()]);
};

/** "kilukkam-canon-in-d-2026-10-24-2130" */
export const takeFileName = (pieceId: string, when: Date, ext: string): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `kilukkam-${pieceId}-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}.${ext}`;
};
