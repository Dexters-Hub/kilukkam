import type { Score } from '@kilukkam/shared';
import { toast } from '../components/Toast.js';
import type { SpotifyTrack } from '../lib/spotify/api.js';
import { buildPlayAlong, type Key } from '../lib/spotify/playalong.js';
import { type ConductorPlayer, type ConnectResult, type PlaybackState, connectPlayer, positionAt } from '../lib/spotify/player.js';
import { barsFromDuration, expectedPosition, planStart, playAlongTitle, seekCorrection, type SongBeat } from '../lib/spotify/sync.js';

// The conductor's Spotify side of a play-along, kept outside React so the
// browser player survives the move from the setup screen into the room.
// Players never reach this module: only the conductor laptop plays the song.

export interface PlayAlongChoice {
  track: SpotifyTrack;
  beat: SongBeat;
  beatsPerBar: number;
  key: Key | null;
}

/** The score the room plays on top of the song */
export const scoreFor = (c: PlayAlongChoice): Score => ({
  ...buildPlayAlong({
    bpm: c.beat.bpm,
    beatsPerBar: c.beatsPerBar,
    bars: barsFromDuration(c.track.durationMs, c.beat, c.beatsPerBar),
    key: c.key,
  }),
  title: playAlongTitle(c.track.name, c.track.artists),
});

// ---------- what the conductor sees: one song status for every screen ----------

export type SongPhase = 'idle' | 'connecting' | 'ready' | 'cued' | 'playing' | 'paused' | 'error';

export interface SongStatus {
  phase: SongPhase;
  /** Why it failed, or a note such as how far the start was corrected */
  message: string | null;
  /** The latest report from the Spotify player, for the progress bar */
  state: PlaybackState | null;
}

let status: SongStatus = { phase: 'idle', message: null, state: null };
const listeners = new Set<() => void>();
const setStatus = (next: Partial<SongStatus>): void => {
  status = { ...status, ...next };
  for (const l of listeners) l();
};
export const songStatus = (): SongStatus => status;
export const onSongStatus = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let player: ConductorPlayer | null = null;
let connecting: Promise<ConnectResult> | null = null;
let chosen: PlayAlongChoice | null = null;
/** Bumped on every start or stop, so a late reply from an old start does nothing */
let run = 0;

/** Connect the browser player once; later calls reuse it. */
export const ensurePlayer = async (): Promise<ConnectResult> => {
  if (player) return { ok: true, player };
  setStatus({ phase: 'connecting', message: null });
  connecting ??= connectPlayer().finally(() => {
    connecting = null;
  });
  const r = await connecting;
  if (r.ok) {
    player = r.player;
    setStatus({ phase: 'ready', message: null });
    // Every report from Spotify updates the card: playing, paused, where it is.
    player.onState((state) => {
      const phase: SongPhase = state.paused ? (status.phase === 'cued' ? 'cued' : 'paused') : 'playing';
      setStatus({ state, phase });
    });
  } else setStatus({ phase: 'error', message: r.message });
  return r;
};

export const currentPlayer = (): ConductorPlayer | null => player;

export const choose = (c: PlayAlongChoice | null): void => {
  chosen = c;
};

export const chosenPlayAlong = (): PlayAlongChoice | null => chosen;

/**
 * The room's beat 0 is at local `startedAtLocal`: start the song so it is on
 * one of its beats right then, and correct once from the first state report.
 */
export const startSong = async (startedAtLocal: number): Promise<void> => {
  const c = chosen;
  const p = player;
  if (!c || !p) return;
  const mine = ++run;
  setStatus({ phase: 'cued', message: 'Starts with the room' });
  const plan = planStart({ songBeatMs: c.beat.songBeatMs, periodMs: c.beat.periodMs, startedAtLocal, nowLocal: Date.now() });
  let corrected = false;
  const off = p.onState((state) => {
    if (corrected || mine !== run || state.paused || state.track?.uri !== c.track.uri) return;
    corrected = true;
    off();
    const now = Date.now();
    const drift = positionAt(state, now) - expectedPosition(plan, startedAtLocal, now);
    const seekTo = seekCorrection(positionAt(state, now), expectedPosition(plan, startedAtLocal, now));
    if (seekTo !== null) void p.seek(seekTo);
    setStatus({ message: seekTo === null ? 'On the beat' : `Nudged ${Math.round(Math.abs(drift))} ms onto the beat` });
  });
  const result = await p.play(c.track.uri, plan.playFromMs);
  if (!result.ok && mine === run) {
    off();
    setStatus({ phase: 'error', message: result.message });
    toast(result.message, 'error');
  }
};

export const stopSong = (): void => {
  run++;
  if (status.phase !== 'idle' && status.phase !== 'error') setStatus({ phase: player ? 'paused' : 'idle', message: null });
  if (player) void player.pause().catch(() => undefined);
};
