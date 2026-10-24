import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { analyseHand, assignSides, type HandFrame, type TrackedHand } from './features.js';

// The camera binding: front camera in, HandFrames out.
//
// Privacy. Frames go from the camera into the hand model inside this tab and
// nowhere else. The only network requests are for the self-hosted model and
// wasm under /mediapipe/. MediaPipe Tasks also posts anonymous usage metrics
// (platform, library version, latency) to Google every minute; pages that
// use this module must ship a Content-Security-Policy with
// `connect-src 'self'`, which blocks that request (see camera.html).
//
// Main thread. Detection is synchronous wasm, so it runs at most once per
// new camera frame (requestVideoFrameCallback where available) and never
// takes more than two thirds of the main thread: after a detection that took
// 24 ms, the next waits at least 12 ms. Up to about 22 ms a frame that still
// means every frame at 30 fps; slower devices drop frames instead of
// starving the audio and the UI.

export type Delegate = 'GPU' | 'CPU';

export interface HandTrackingOptions {
  /** Hands to look for. The conductor wants 2, air play 1. */
  numHands?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Report x as seen in a mirrored preview (default true) */
  mirror?: boolean;
  /** GPU is faster where WebGL2 works; falls back to CPU by itself */
  delegate?: Delegate;
  /** Where the model and wasm live */
  assetBase?: string;
  onStats?: (stats: TrackingStats) => void;
  /** Tracking stopped by itself (the model keeps failing on this device) */
  onError?: (err: CameraError) => void;
}

export interface TrackingStats {
  /** Mean detection time over the last half second */
  detectMs: number;
  /** Detections per second */
  fps: number;
  /** Camera frames skipped to leave the main thread free */
  skipped: number;
  delegate: Delegate;
}

export type CameraErrorReason = 'insecure' | 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'model';

export class CameraError extends Error {
  constructor(
    readonly reason: CameraErrorReason,
    message: string,
    options?: { cause: unknown },
  ) {
    super(message, options);
    this.name = 'CameraError';
  }
}

export interface HandTracking {
  stop(): void;
  readonly delegate: Delegate;
}

const DEFAULT_BASE = '/mediapipe/';
/** Idle time owed after each detection, as a share of its cost (2/3 duty at most) */
const IDLE_SHARE = 0.5;
/** Consecutive failed frames (about half a second) before tracking gives up */
const MAX_FAILURES = 15;

interface LoadedModel {
  landmarker: HandLandmarker;
  delegate: Delegate;
}

const models = new Map<string, Promise<LoadedModel>>();

/**
 * Load (once) and return the hand model. Safe to call early, for example
 * while the conductor reads the screen, so Start is instant.
 */
export function loadHandModel(opts: { delegate?: Delegate; assetBase?: string } = {}): Promise<LoadedModel> {
  const base = opts.assetBase ?? DEFAULT_BASE;
  const want = opts.delegate ?? 'GPU';
  const key = `${base}|${want}`;
  const cached = models.get(key);
  if (cached) return cached;
  const job = (async (): Promise<LoadedModel> => {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    // Only the SIMD build is self-hosted (every browser since Safari 16.4 has wasm SIMD).
    if (!(await FilesetResolver.isSimdSupported())) {
      throw new CameraError('unsupported', 'This browser is too old for camera play.');
    }
    const fileset = {
      wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`,
      wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm`,
    };
    const create = (delegate: Delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
    try {
      return { landmarker: await create(want), delegate: want };
    } catch (err) {
      if (want === 'CPU') throw err;
      console.warn('GPU hand tracking unavailable, using CPU', err);
      return { landmarker: await create('CPU'), delegate: 'CPU' };
    }
  })().catch((err: unknown) => {
    models.delete(key);
    throw err instanceof CameraError ? err : new CameraError('model', 'The hand model could not load.', { cause: err });
  });
  models.set(key, job);
  return job;
}

/**
 * Start fetching and compiling the hand model in the background shortly after
 * a conductor screen opens, so Start does not wait on an 11 MB download.
 * Shaped for `useEffect(warmHandModel, [])`: returns its own cancel.
 */
export const warmHandModel = (): (() => void) => {
  const id = window.setTimeout(() => void loadHandModel().catch(() => {}), 1200);
  return () => window.clearTimeout(id);
};

const cameraError = (err: unknown): CameraError => {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CameraError('denied', 'Camera permission was refused.', { cause: err });
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CameraError('not-found', 'No front camera found.', { cause: err });
  if (name === 'NotReadableError' || name === 'AbortError') return new CameraError('in-use', 'The camera is busy in another app.', { cause: err });
  return new CameraError('unsupported', 'The camera could not start.', { cause: err });
};

type VideoWithFrames = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Start the front camera and emit one HandFrame per processed camera frame,
 * including frames with no hands (so callers know a hand has gone).
 */
export async function startHandTracking(
  video: HTMLVideoElement,
  onFrame: (frame: HandFrame) => void,
  opts: HandTrackingOptions = {},
): Promise<HandTracking> {
  if (!window.isSecureContext) throw new CameraError('insecure', 'Camera play needs https or localhost.');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', 'This browser has no camera access.');

  const modelOpts: { delegate?: Delegate; assetBase?: string } = {};
  if (opts.delegate) modelOpts.delegate = opts.delegate;
  if (opts.assetBase) modelOpts.assetBase = opts.assetBase;
  const model = loadHandModel(modelOpts);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: opts.width ?? 640 },
        height: { ideal: opts.height ?? 480 },
        frameRate: { ideal: opts.fps ?? 30, max: opts.fps ?? 30 },
      },
    });
  } catch (err) {
    throw cameraError(err);
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

  let loaded: LoadedModel;
  try {
    loaded = await model;
    await loaded.landmarker.setOptions({ numHands: opts.numHands ?? 2 });
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    stopTracks();
    video.srcObject = null;
    throw err instanceof CameraError ? err : cameraError(err);
  }

  const { landmarker, delegate } = loaded;
  const mirror = opts.mirror ?? true;
  const v = video as VideoWithFrames;
  const useVfc = typeof v.requestVideoFrameCallback === 'function';

  let stopped = false;
  let paused = document.hidden;
  let handle: number | null = null;
  let lastVideoTime = -1;
  let lastTs = 0;
  let lastEnd = 0;
  let meanMs = 0;
  let skipped = 0;
  let windowStart = performance.now();
  let windowCount = 0;
  let windowMs = 0;
  let failures = 0;

  const schedule = () => {
    if (stopped || paused) return;
    handle = useVfc && v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (handle === null) return;
    if (useVfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
    handle = null;
  };

  function tick(): void {
    handle = null;
    if (stopped || paused) return;
    schedule();
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    const start = performance.now();
    if (start - lastEnd < meanMs * IDLE_SHARE) {
      skipped++;
      return;
    }
    lastVideoTime = video.currentTime;
    const ts = Math.max(start, lastTs + 1);
    lastTs = ts;
    let result: HandLandmarkerResult;
    try {
      result = landmarker.detectForVideo(video, ts);
      failures = 0;
    } catch (err) {
      // One bad frame is noise; a run of them means this device cannot run the model.
      if (++failures === 1) console.warn('Hand detection failed on a frame', err);
      if (failures >= MAX_FAILURES) {
        tracking.stop();
        opts.onError?.(new CameraError('model', 'Hand tracking stopped: the model keeps failing here.', { cause: err }));
      }
      return;
    }
    const end = performance.now();
    const ms = end - start;
    lastEnd = end;
    meanMs = meanMs === 0 ? ms : meanMs * 0.8 + ms * 0.2;
    windowCount++;
    windowMs += ms;
    if (opts.onStats && end - windowStart >= 500) {
      opts.onStats({ detectMs: windowMs / windowCount, fps: (windowCount * 1000) / (end - windowStart), skipped, delegate });
      windowStart = end;
      windowCount = 0;
      windowMs = 0;
    }

    const aspect = (video.videoWidth || 4) / (video.videoHeight || 3);
    const hands: TrackedHand[] = [];
    result.landmarks.forEach((lms, i) => {
      const label = result.handedness[i]?.[0];
      const hand = analyseHand(lms, label?.categoryName ?? '', label?.score ?? 0, { aspect, mirror });
      if (hand) hands.push(hand);
    });
    onFrame({ t: start, aspect, hands: assignSides(hands) });
  }

  const onVisibility = () => {
    if (stopped) return;
    if (document.hidden) {
      paused = true;
      cancel();
      stream.getVideoTracks().forEach((t) => (t.enabled = false));
    } else {
      paused = false;
      stream.getVideoTracks().forEach((t) => (t.enabled = true));
      void video.play().catch(() => {});
      schedule();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const tracking: HandTracking = {
    delegate,
    stop() {
      if (stopped) return;
      stopped = true;
      cancel();
      document.removeEventListener('visibilitychange', onVisibility);
      stopTracks();
      video.pause();
      video.srcObject = null;
    },
  };
  schedule();
  return tracking;
}

/** Free the model's memory (it is otherwise kept for the next start). */
export async function releaseHandModel(): Promise<void> {
  const all = [...models.values()];
  models.clear();
  for (const job of all) {
    try {
      (await job).landmarker.close();
    } catch {
      // never loaded; nothing to free
    }
  }
}
