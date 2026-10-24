import type { Score } from '@kilukkam/shared';
import { arrange, MAX_TRACKS, type ImportReport } from './arrange.js';
import { parseMidi } from './parse.js';

// Any MIDI file in, a Kilukkam score out. Pure: no DOM, no network, and the
// same bytes always give the same score, so the conductor screen and the
// import script share it.

export type { ImportReport, PartReport, Role } from './arrange.js';

export interface ImportOptions {
  /** Defaults to the file's own name */
  title?: string;
  composer?: string;
  /** Instruments to arrange for, 1 to 8; defaults to 5 */
  maxParts?: number;
  /** Longer songs end at a phrase before this; defaults to 300 (five minutes) */
  maxSeconds?: number;
}

export interface ImportResult {
  score: Score;
  report: ImportReport;
}

const DEFAULT_PARTS = 5;
const DEFAULT_SECONDS = 300;

/** FNV-1a over the file bytes: a stable id for the same file. */
function fingerprint(buf: ArrayBuffer): string {
  let hash = 0x811c9dc5;
  for (const byte of new Uint8Array(buf)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const clampInt = (v: number | undefined, fallback: number, low: number, high: number): number =>
  v === undefined || !Number.isFinite(v) ? fallback : Math.min(high, Math.max(low, Math.round(v)));

export function importMidi(buf: ArrayBuffer, opts: ImportOptions = {}): ImportResult {
  const song = parseMidi(buf);
  const maxSeconds = opts.maxSeconds !== undefined && opts.maxSeconds > 0 ? opts.maxSeconds : DEFAULT_SECONDS;
  return arrange(song, {
    id: `midi-${fingerprint(buf)}`,
    title: opts.title?.trim() || song.name || 'Imported song',
    composer: opts.composer?.trim() || 'Unknown',
    maxParts: clampInt(opts.maxParts, DEFAULT_PARTS, 1, MAX_TRACKS),
    maxSeconds,
  });
}
