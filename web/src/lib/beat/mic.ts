import { type BpmCandidates, createRealtimeBpmAnalyzer, getBiquadFilter } from 'realtime-bpm-analyzer';
import { captureTimeMs, hintFrom } from './capture.js';
import { type BeatEstimate, type BeatFit, type Onset, OnsetDetector, type TempoHint, fitBeat, fuse, stabilise, toEstimate } from './detect.js';

// The conductor laptop's microphone, listening to the speaker that plays
// Spotify. Two analyses run side by side on the same input: our onset
// detector (detect.ts), which gives tempo and phase, and the
// realtime-bpm-analyzer library, whose tempo is a second opinion. Browser
// voice processing is switched off: echo cancellation would try to remove
// exactly the music we want to hear, and gain control would flatten the hits.
//
// Nothing is played back (no feedback); both analysers feed a muted gain so
// the browser keeps pulling audio through them.

/** A tiny capture worklet: hands the main thread 1024 frame blocks stamped with their first frame. */
const CAPTURE_WORKLET = `
class KilukkamCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.first = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.first = currentFrame + i;
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) {
        this.port.postMessage({ frame: this.first, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(1024);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('kilukkam-capture', KilukkamCapture);
`;

export type MicIssue = 'unsupported' | 'denied' | 'no_microphone' | 'failed';

export type MicStart = { ok: true; listener: BeatListener } | { ok: false; issue: MicIssue; message: string };

const MIC_MESSAGES: Record<MicIssue, string> = {
  unsupported: 'This browser cannot listen to the microphone.',
  denied: 'Allow the microphone so Kilukkam can hear the beat.',
  no_microphone: 'No microphone found on this laptop.',
  failed: 'Could not start listening. Try again.',
};

export interface BeatListener {
  /** Latest estimate, or null until the beat is found */
  current(): BeatEstimate | null;
  /** Every new estimate; returns the unsubscribe */
  onEstimate(cb: (e: BeatEstimate) => void): () => void;
  /** Forget the song (call when the track changes) */
  reset(): void;
  stop(): Promise<void>;
}

export interface ListenOptions {
  /** Server minus local ms; pass () => clock.now() - Date.now() from the room's ServerClock */
  serverOffsetMs?: () => number;
  /** Extra delay to subtract, from a calibration; added to what the browser reports */
  extraLatencyMs?: number;
  /** How often to refit (ms) */
  refitEveryMs?: number;
}

const KEEP_ONSETS_MS = 15_000;

const isBlock = (v: unknown): v is { frame: number; samples: Float32Array } =>
  typeof v === 'object' && v !== null && 'frame' in v && 'samples' in v && typeof v.frame === 'number' && v.samples instanceof Float32Array;

/** Input latency the browser reports for the track (seconds in the spec), as ms; 0 when it does not say. */
const reportedInputLatencyMs = (track: MediaStreamTrack | undefined): number => {
  const latency: unknown = track ? Reflect.get(track.getSettings(), 'latency') : undefined;
  return typeof latency === 'number' && Number.isFinite(latency) && latency >= 0 && latency < 1 ? latency * 1000 : 0;
};

/** Context time heard now, and when; falls back to the render clock where the browser leaves the stamp empty. */
const outputStamp = (ctx: AudioContext): { contextTime: number; performanceTime: number } => {
  const { contextTime, performanceTime } = ctx.getOutputTimestamp();
  return contextTime !== undefined && performanceTime !== undefined && performanceTime > 0
    ? { contextTime, performanceTime }
    : { contextTime: ctx.currentTime, performanceTime: performance.now() };
};

const micIssue = (e: unknown): MicIssue => {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_microphone';
  return 'failed';
};

/** Start listening. Call it from a tap: the AudioContext can only start after a user gesture. */
export const listen = async (opts: ListenOptions = {}): Promise<MicStart> => {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
    return { ok: false, issue: 'unsupported', message: MIC_MESSAGES.unsupported };
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (e) {
    const issue = micIssue(e);
    return { ok: false, issue, message: MIC_MESSAGES[issue] };
  }

  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const captureUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule(captureUrl);
    const analyzer = await createRealtimeBpmAnalyzer(ctx, { continuousAnalysis: true });
    URL.revokeObjectURL(captureUrl);

    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, 'kilukkam-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const lowpass = getBiquadFilter(ctx);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(capture).connect(mute);
    source.connect(lowpass).connect(analyzer.node).connect(mute);
    mute.connect(ctx.destination);

    const inputLatencyMs = reportedInputLatencyMs(stream.getAudioTracks()[0]) + (opts.extraLatencyMs ?? 0);
    const serverOffset = opts.serverOffsetMs ?? (() => 0);
    const refitEvery = opts.refitEveryMs ?? 500;
    const detector = new OnsetDetector({ sampleRate: ctx.sampleRate });
    const listeners = new Set<(e: BeatEstimate) => void>();
    let onsets: Onset[] = [];
    let hint: TempoHint | null = null;
    let published: BeatFit | null = null;
    let estimate: BeatEstimate | null = null;
    let lastFit = -Infinity;

    const onHint = (data: BpmCandidates) => {
      hint = hintFrom(data);
    };
    analyzer.on('bpm', onHint);
    analyzer.on('bpmStable', onHint);

    capture.port.onmessage = (ev: MessageEvent<unknown>) => {
      const block = ev.data;
      if (!isBlock(block)) return;
      const startMs = captureTimeMs({
        frameSeconds: block.frame / ctx.sampleRate,
        stamp: outputStamp(ctx),
        timeOrigin: performance.timeOrigin,
        outputLatencySeconds: ctx.outputLatency || ctx.baseLatency,
        inputLatencyMs,
      });
      const found = detector.push(block.samples, startMs);
      if (found.length === 0) return;
      onsets.push(...found);
      const newest = found[found.length - 1]?.t ?? startMs;
      onsets = onsets.filter((o) => newest - o.t <= KEEP_ONSETS_MS);
      if (newest - lastFit < refitEvery) return;
      lastFit = newest;
      const fit = fuse(onsets, fitBeat(onsets), hint);
      if (!fit) return;
      published = stabilise(onsets, fit, published?.bpm ?? null);
      const next = toEstimate(published, serverOffset(), 'mic');
      estimate = next;
      for (const l of listeners) l(next);
    };

    return {
      ok: true,
      listener: {
        current: () => estimate,
        onEstimate(cb) {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        reset() {
          detector.reset();
          analyzer.reset();
          onsets = [];
          hint = null;
          published = null;
          estimate = null;
        },
        async stop() {
          listeners.clear();
          capture.port.onmessage = null;
          analyzer.stop();
          source.disconnect();
          for (const t of stream.getTracks()) t.stop();
          await ctx.close();
        },
      },
    };
  } catch {
    URL.revokeObjectURL(captureUrl);
    for (const t of stream.getTracks()) t.stop();
    await ctx.close().catch(() => undefined);
    return { ok: false, issue: 'failed', message: MIC_MESSAGES.failed };
  }
};
