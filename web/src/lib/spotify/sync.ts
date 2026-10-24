import { CUSTOM_PIECE_LIMITS, MAX_BPM, MIN_BPM } from '@kilukkam/shared';
import { tapTempo } from '../beat/detect.js';
import { PLAYALONG_LIMITS } from './playalong.js';

// Design note: keeping a Spotify song on the room's beat grid.
//
// The conductor taps along while the song plays; each tap is stamped with
// the song position (not the wall clock), so the fit says where the beats sit
// inside the song itself: a period and one beat's song time (songBeatMs).
// When the room starts, its beat 0 falls on startedAt. We start Spotify so
// that at that moment the song is exactly on one of its own beats:
//
//   song position at local time t = targetSongMs + (t - startedAtLocal)
//
// with targetSongMs = songBeatMs + k * period for the smallest k that keeps
// the start position at or after the song's beginning. Spotify takes a
// moment to start, so we ask for a position slightly ahead, then compare
// the first reported position with the expected one and seek once if it is
// off by more than a tolerance. All of it is pure maths over milliseconds.

export interface SongBeat {
  bpm: number;
  periodMs: number;
  /** Song time (ms) of the first fitted beat in the song, in [0, periodMs) */
  songBeatMs: number;
  /** 0 to 1, from the spread of the taps */
  confidence: number;
}

/** Halve or double a tempo into the room's range; the beat grid stays on the same beats. */
export const foldBpm = (bpm: number): number | null => {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  let b = bpm;
  while (b > MAX_BPM) b /= 2;
  while (b < MIN_BPM) b *= 2;
  return b <= MAX_BPM ? b : null;
};

/** Smallest beat of the grid (songBeatMs + k * period, any integer k) at or after `atLeastMs`. */
export const beatAtOrAfter = (songBeatMs: number, periodMs: number, atLeastMs: number): number => {
  const k = Math.ceil((atLeastMs - songBeatMs) / periodMs - 1e-9);
  return songBeatMs + k * periodMs;
};

/** Beat grid inside the song from taps stamped with song positions (ms). Null until 4 steady taps. */
export const songBeatFromTaps = (songTaps: readonly number[]): SongBeat | null => {
  const fit = tapTempo(songTaps);
  if (!fit) return null;
  const bpm = foldBpm(fit.bpm);
  if (bpm === null) return null;
  const periodMs = 60_000 / bpm;
  const songBeatMs = beatAtOrAfter(fit.anchorMs, periodMs, 0);
  return { bpm, periodMs, songBeatMs, confidence: fit.confidence };
};

/** Most bars a play-along can have: the shared limit, and the server's event cap (drums play 2 events per beat). */
export const maxBarsFor = (beatsPerBar: number): number =>
  Math.min(PLAYALONG_LIMITS.maxBars, Math.floor(CUSTOM_PIECE_LIMITS.maxEventsPerTrack / (2 * beatsPerBar)));

/** The count-in before the first downbeat; the song plays through it */
export const COUNT_IN_MS = 3000;

/**
 * Whole bars from the start beat to the end of the song, clamped to what a
 * play-along score can hold. The start beat is the first beat after the
 * count-in, the usual way a room starts.
 */
export const barsFromDuration = (durationMs: number, beat: Pick<SongBeat, 'songBeatMs' | 'periodMs'>, beatsPerBar: number, introMs = COUNT_IN_MS): number => {
  const start = beatAtOrAfter(beat.songBeatMs, beat.periodMs, introMs);
  const bars = Math.floor((durationMs - start) / (beat.periodMs * beatsPerBar));
  return Math.max(PLAYALONG_LIMITS.minBars, Math.min(maxBarsFor(beatsPerBar), Number.isFinite(bars) ? bars : 0));
};

/** Score titles are capped by the server; cut at a word where we can and mark the cut. */
export const playAlongTitle = (name: string, artists: readonly string[], max = CUSTOM_PIECE_LIMITS.maxTitleLen): string => {
  const full = artists.length ? `${name} by ${artists.join(', ')}` : name;
  if (full.length <= max) return full;
  const cut = full.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

export interface StartInput {
  songBeatMs: number;
  periodMs: number;
  /** Local epoch ms of the room's beat 0 (server startedAt through the ServerClock) */
  startedAtLocal: number;
  /** Local epoch ms now, when play is about to be called */
  nowLocal: number;
  /** How far ahead to ask for, to absorb Spotify's start delay */
  leadMs?: number;
}

export interface StartPlan {
  /** Song position that must be playing at startedAtLocal: always on a song beat */
  targetSongMs: number;
  /** Position to pass to play() now */
  playFromMs: number;
}

/** Typical gap between asking Spotify to play and the audio starting */
export const START_LEAD_MS = 150;

/** Where to start the song so it is on a beat when the room's beat 0 arrives. */
export const planStart = ({ songBeatMs, periodMs, startedAtLocal, nowLocal, leadMs = START_LEAD_MS }: StartInput): StartPlan => {
  const untilStart = startedAtLocal - nowLocal;
  // The song runs from now, so by startedAt it has advanced untilStart: the target must be at least that far in.
  const targetSongMs = beatAtOrAfter(songBeatMs, periodMs, Math.max(0, untilStart));
  return { targetSongMs, playFromMs: Math.max(0, targetSongMs - untilStart + leadMs) };
};

/** Song position the room expects at local time `t`. */
export const expectedPosition = (plan: Pick<StartPlan, 'targetSongMs'>, startedAtLocal: number, t: number): number =>
  plan.targetSongMs + (t - startedAtLocal);

/** Off by more than this, a seek is worth the small glitch it causes */
export const SEEK_TOLERANCE_MS = 40;

/** Position to seek to when the actual position drifted past the tolerance, otherwise null. */
export const seekCorrection = (actualMs: number, expectedMs: number, toleranceMs = SEEK_TOLERANCE_MS): number | null =>
  Math.abs(actualMs - expectedMs) > toleranceMs ? Math.max(0, expectedMs) : null;
