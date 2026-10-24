import type { BpmCandidates } from 'realtime-bpm-analyzer';
import type { TempoHint } from './detect.js';

// Pure helpers for the microphone path in mic.ts, kept apart so they are
// tested without loading WebAudio or the analyzer library.

export interface CaptureTiming {
  /** Context time (s) of the block's first frame */
  frameSeconds: number;
  /** From AudioContext.getOutputTimestamp(): context time currently heard, and the performance time of that */
  stamp: { contextTime: number; performanceTime: number };
  timeOrigin: number;
  outputLatencySeconds: number;
  inputLatencyMs: number;
}

/**
 * Local epoch ms at which the sound in a captured block reached the
 * microphone. A frame is rendered `outputLatency` before it is heard, and
 * the input it carries was captured `inputLatency` before it was rendered.
 */
export const captureTimeMs = ({ frameSeconds, stamp, timeOrigin, outputLatencySeconds, inputLatencyMs }: CaptureTiming): number =>
  timeOrigin + stamp.performanceTime + (frameSeconds - stamp.contextTime) * 1000 - outputLatencySeconds * 1000 - inputLatencyMs;

/** The library's strongest candidate, if it has one. */
export const hintFrom = (data: BpmCandidates): TempoHint | null => {
  const top = data.bpm[0];
  return top && top.tempo > 0 ? { bpm: top.tempo, confidence: Math.max(0, Math.min(1, top.confidence)) } : null;
};
