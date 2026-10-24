export type InstrumentId = 'violin' | 'cello' | 'flute' | 'piano';

export interface NoteEvent {
  kind: 'note';
  /** MIDI note number, 0-127 */
  midi: number;
  /** Duration in beats (quarter note = 1) */
  beats: number;
  /** 0-127, defaults to a mid value at playback */
  velocity?: number;
}

export interface RestEvent {
  kind: 'rest';
  beats: number;
}

export type ScoreEvent = NoteEvent | RestEvent;

export interface Track {
  id: string;
  name: string;
  instrument: InstrumentId;
  maxPlayers: number;
  events: ScoreEvent[];
}

export interface Score {
  id: string;
  title: string;
  composer: string;
  /** Quarter-note tempo */
  bpm: number;
  beatsPerBar: number;
  tracks: Track[];
}

export function note(midi: number, beats: number, velocity?: number): NoteEvent {
  return velocity === undefined
    ? { kind: 'note', midi, beats }
    : { kind: 'note', midi, beats, velocity };
}

export function rest(beats: number): RestEvent {
  return { kind: 'rest', beats };
}

export function totalBeats(events: readonly ScoreEvent[]): number {
  return events.reduce((sum, e) => sum + e.beats, 0);
}

const INSTRUMENTS: readonly InstrumentId[] = ['violin', 'cello', 'flute', 'piano'];

export function isInstrumentId(v: unknown): v is InstrumentId {
  return typeof v === 'string' && (INSTRUMENTS as string[]).includes(v);
}

export function validateScore(score: Score): string[] {
  const errors: string[] = [];
  if (!(score.bpm > 0)) errors.push('bpm must be > 0');
  if (!(score.beatsPerBar > 0)) errors.push('beatsPerBar must be > 0');
  if (score.tracks.length === 0) errors.push('score has no tracks');

  const seen = new Set<string>();
  for (const track of score.tracks) {
    if (seen.has(track.id)) errors.push(`duplicate track id: ${track.id}`);
    seen.add(track.id);
    if (!isInstrumentId(track.instrument)) {
      errors.push(`track ${track.id}: unknown instrument ${String(track.instrument)}`);
    }
    if (track.events.length === 0) errors.push(`track ${track.id} has no events`);
    track.events.forEach((e, i) => {
      if (e.kind === 'note' && (e.midi < 0 || e.midi > 127)) {
        errors.push(`track ${track.id} event ${i}: midi ${e.midi} out of range`);
      }
      if (!(e.beats > 0)) {
        errors.push(`track ${track.id} event ${i}: beats must be > 0`);
      }
    });
  }
  return errors;
}

/**
 * Build a canon stagger: the same events delayed by `offsetBeats`,
 * prepended with a rest and trimmed so the track length is unchanged.
 */
export function offsetTrack(track: Track, id: string, name: string, offsetBeats: number): Track {
  if (offsetBeats <= 0) {
    return { ...track, id, name, events: [...track.events] };
  }
  const events: ScoreEvent[] = [rest(offsetBeats)];
  const target = totalBeats(track.events);
  let acc = offsetBeats;
  for (const e of track.events) {
    if (acc + e.beats > target) break;
    events.push({ ...e });
    acc += e.beats;
  }
  return { ...track, id, name, events };
}
