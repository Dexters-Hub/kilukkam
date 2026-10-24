// Echo: Simon says across the room. The state is plain data (the PRNG
// state rides along) so the server can hold it and replay it.
import { nextRandom } from './seed.js';

export interface EchoState {
  scale: readonly number[];
  sequence: number[];
  round: number;
  /** mulberry32 state after the last draw */
  rng: number;
}

export interface EchoJudgement {
  ok: boolean;
  failedAt: number | null;
}

function draw(scale: readonly number[], rng: number): { note: number; rng: number } {
  const r = nextRandom(rng);
  return { note: scale[Math.floor(r.value * scale.length)]!, rng: r.state };
}

export function start(seed: number, scale: readonly number[]): EchoState {
  if (scale.length === 0) throw new RangeError('empty scale');
  const first = draw(scale, seed >>> 0);
  return { scale: [...scale], sequence: [first.note], round: 1, rng: first.rng };
}

export function extend(state: EchoState): EchoState {
  const next = draw(state.scale, state.rng);
  return {
    ...state,
    sequence: [...state.sequence, next.note],
    round: state.round + 1,
    rng: next.rng,
  };
}

/** `failedAt` is the first wrong, missing or extra tap */
export function judgeEcho(state: EchoState, taps: readonly number[]): EchoJudgement {
  const n = Math.max(state.sequence.length, taps.length);
  for (let i = 0; i < n; i++) {
    if (taps[i] !== state.sequence[i]) return { ok: false, failedAt: i };
  }
  return { ok: true, failedAt: null };
}
