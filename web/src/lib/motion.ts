// Motion play: the phone itself becomes the instrument. Bow it, shake it,
// tilt it. The detectors are pure (samples in, gestures out) so they are unit
// tested; the browser binding at the bottom only adapts DeviceMotion events.

export interface MotionSample {
  /** ms */
  t: number;
  /** Linear acceleration without gravity, m/s² (DeviceMotionEvent.acceleration) */
  x: number;
  y: number;
  z: number;
}

export type MotionGesture =
  /** A bow stroke started: play the next note */
  | { kind: 'stroke'; direction: 1 | -1; strength: number }
  /** The bow stopped moving: let the note go */
  | { kind: 'release' }
  /** A sharp shake: a percussive hit */
  | { kind: 'shake'; strength: number };

const magnitude = (s: MotionSample): number => Math.hypot(s.x, s.y, s.z);

/**
 * Bowing: a stroke is a push along the phone's long sweep axis that crosses a
 * threshold, and reversing direction starts the next stroke (down-bow, up-bow).
 * Stillness for a moment releases the note.
 */
export class BowDetector {
  private direction: 0 | 1 | -1 = 0;
  private lastStroke = -Infinity;
  private moving = false;
  private quietSince = 0;

  constructor(
    private readonly threshold = 3.2,
    private readonly minGapMs = 180,
    private readonly releaseAfterMs = 160,
    private readonly stillLevel = 0.9,
  ) {}

  push(s: MotionSample): MotionGesture | null {
    // The sweep axis is whichever horizontal axis is moving most right now.
    const along = Math.abs(s.x) >= Math.abs(s.y) ? s.x : s.y;
    const dir: 1 | -1 = along >= 0 ? 1 : -1;
    if (Math.abs(along) >= this.threshold && dir !== this.direction && s.t - this.lastStroke >= this.minGapMs) {
      this.direction = dir;
      this.lastStroke = s.t;
      this.moving = true;
      this.quietSince = 0;
      return { kind: 'stroke', direction: dir, strength: Math.min(1, Math.abs(along) / (this.threshold * 3)) };
    }
    if (!this.moving) return null;
    if (magnitude(s) < this.stillLevel) {
      if (!this.quietSince) this.quietSince = s.t;
      if (s.t - this.quietSince >= this.releaseAfterMs) {
        this.moving = false;
        this.direction = 0;
        return { kind: 'release' };
      }
    } else {
      this.quietSince = 0;
    }
    return null;
  }
}

/** Shaking: a spike well above normal handling, with a short refractory period like a maraca. */
export class ShakeDetector {
  private last = -Infinity;
  constructor(
    private readonly threshold = 13,
    private readonly refractoryMs = 140,
  ) {}

  push(s: MotionSample): MotionGesture | null {
    const m = magnitude(s);
    if (m < this.threshold || s.t - this.last < this.refractoryMs) return null;
    this.last = s.t;
    return { kind: 'shake', strength: Math.min(1, m / (this.threshold * 2.5)) };
  }
}

/**
 * Tilt to swell: phone flat on a table (beta near 0) plays softly, held up
 * towards the audience (beta near 75) plays full. Returns the 0.3 to 1.6
 * expression level the audio engine expects.
 */
export const tiltLevel = (betaDeg: number): number => {
  const clamped = Math.max(0, Math.min(90, Math.abs(betaDeg)));
  return 0.4 + (clamped / 75) * 1.0 > 1.6 ? 1.6 : Math.max(0.3, 0.4 + (clamped / 75) * 1.0);
};

// ---------- browser binding ----------

type PermissionResponse = 'granted' | 'denied' | 'default';
interface MotionPermissionApi {
  requestPermission?: () => Promise<PermissionResponse>;
}

export const motionSupported = (): boolean => typeof window !== 'undefined' && 'DeviceMotionEvent' in window;

/**
 * Ask for motion access. iOS requires this inside a user gesture (a tap);
 * Android and desktop grant it without a prompt.
 */
export const requestMotion = async (): Promise<boolean> => {
  if (!motionSupported()) return false;
  const api = window.DeviceMotionEvent as unknown as MotionPermissionApi;
  if (typeof api.requestPermission !== 'function') return true;
  try {
    return (await api.requestPermission()) === 'granted';
  } catch {
    return false;
  }
};

export interface MotionOptions {
  bow?: boolean;
  shake?: boolean;
  tilt?: boolean;
  onGesture(g: MotionGesture): void;
  onTilt?(level: number): void;
}

/** Start listening; returns a function that stops. Call requestMotion() first on iOS. */
export const listenMotion = (opts: MotionOptions): (() => void) => {
  const bow = new BowDetector();
  const shake = new ShakeDetector();
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const s: MotionSample = { t: e.timeStamp, x: a.x, y: a.y, z: a.z };
    const g = (opts.shake && shake.push(s)) || (opts.bow && bow.push(s)) || null;
    if (g) opts.onGesture(g);
  };
  const onTilt = (e: DeviceOrientationEvent) => {
    if (e.beta !== null) opts.onTilt?.(tiltLevel(e.beta));
  };
  window.addEventListener('devicemotion', onMotion);
  if (opts.tilt) window.addEventListener('deviceorientation', onTilt);
  return () => {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientation', onTilt);
  };
};
