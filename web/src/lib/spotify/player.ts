import { type SpotifyApi, SpotifyApiError, spotifyApi } from './api.js';
import { type SpotifyAuth, spotifyAuth } from './auth.js';
import { finiteNumber, httpsUrl, isRecord, nonEmptyString } from './json.js';

// The conductor laptop becomes a Spotify device through the Web Playback
// SDK, which streams full tracks in the browser for Premium accounts. The
// stream is DRM protected (EME), so WebAudio cannot read it: the beat comes
// from the microphone instead (see lib/beat). The SDK script is third-party
// code, so it is only fetched after sign-in, and everything it hands back is
// validated like any other outside JSON.
//
// Browsers only start audio from a user gesture. On iOS and Safari the SDK
// must be "activated" inside a tap before the first play, so `play` reports
// `needs_tap` instead of failing silently.

export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
export const PLAYER_NAME = 'Kilukkam conductor';

/** The slice of the SDK's Spotify.Player we use. */
export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: unknown) => void): boolean;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  activateElement(): Promise<void>;
}

interface SdkPlayerOptions {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume: number;
}

export interface SdkNamespace {
  Player: new (opts: SdkPlayerOptions) => SdkPlayer;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: unknown;
  }
}

const isSdk = (v: unknown): v is SdkNamespace => isRecord(v) && typeof v['Player'] === 'function';

export interface NowPlaying {
  uri: string;
  name: string;
  artists: string[];
  albumArt: string | null;
}

export interface PlaybackState {
  positionMs: number;
  durationMs: number;
  paused: boolean;
  track: NowPlaying | null;
  /** Local epoch ms at which `positionMs` was true */
  sampledAt: number;
}

/** Validate the SDK's player_state_changed payload (null means another device took over). */
export const parsePlayerState = (raw: unknown, now: number): PlaybackState | null => {
  if (!isRecord(raw)) return null;
  const positionMs = finiteNumber(raw['position']);
  const durationMs = finiteNumber(raw['duration']);
  const paused = raw['paused'];
  if (positionMs === null || durationMs === null || typeof paused !== 'boolean') return null;
  const win = raw['track_window'];
  const cur = isRecord(win) ? win['current_track'] : null;
  let track: NowPlaying | null = null;
  if (isRecord(cur)) {
    const uri = nonEmptyString(cur['uri']);
    const name = nonEmptyString(cur['name']);
    if (uri && name) {
      const artists = Array.isArray(cur['artists'])
        ? cur['artists'].flatMap((a: unknown) => {
            const n = isRecord(a) ? nonEmptyString(a['name']) : null;
            return n ? [n] : [];
          })
        : [];
      const album = cur['album'];
      const images = isRecord(album) && Array.isArray(album['images']) ? album['images'] : [];
      const first: unknown = images[0];
      track = { uri, name, artists, albumArt: isRecord(first) ? httpsUrl(first['url']) : null };
    }
  }
  return { positionMs, durationMs, paused, track, sampledAt: finiteNumber(raw['timestamp']) ?? now };
};

/** Where playback is at local epoch `now`, extrapolating while it plays. */
export const positionAt = (s: PlaybackState, now: number): number =>
  s.paused ? s.positionMs : Math.min(s.durationMs, s.positionMs + Math.max(0, now - s.sampledAt));

/**
 * iOS (including iPadOS, which reports a Mac user agent with touch) and
 * desktop Safari only start the SDK's audio from inside a user gesture.
 */
export const needsTapToStart = (userAgent: string, maxTouchPoints: number): boolean => {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const safari = /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|CriOS\/|Edg\/|Firefox\/|FxiOS\//.test(userAgent);
  return ios || safari;
};

// Loading the SDK

let sdkLoading: Promise<SdkNamespace> | null = null;

/** Fetch the SDK script once. A failed load can be retried. */
const loadSdk = (timeoutMs: number): Promise<SdkNamespace> => {
  if (isSdk(window.Spotify)) return Promise.resolve(window.Spotify);
  sdkLoading ??= new Promise<SdkNamespace>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timer);
      if (isSdk(window.Spotify)) resolve(window.Spotify);
      else reject(new Error('sdk'));
    };
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('load'));
    };
    document.head.append(script);
  }).catch((e: unknown) => {
    sdkLoading = null;
    throw e;
  });
  return sdkLoading;
};

// The player

export type PlayResult =
  | { ok: true }
  /** Call `activate()` from a tap handler, then play again */
  | { ok: false; issue: 'needs_tap'; message: string }
  | { ok: false; issue: 'rejected' | 'did_not_start'; message: string };

export interface ConductorPlayer {
  readonly deviceId: string;
  /** True on iOS and Safari: the first play must follow `activate()` inside a tap */
  readonly tapToStart: boolean;
  /** Unlock audio. Call it synchronously from the tap handler, before awaiting anything. */
  activate(): Promise<void>;
  play(uri: string, positionMs: number): Promise<PlayResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  /** Every playback change; returns the unsubscribe */
  onState(listener: (state: PlaybackState) => void): () => void;
  disconnect(): void;
}

/** How long `play` waits for the SDK to report the track actually running */
const START_WAIT_MS = 4000;

export interface WrapOptions {
  sdk: SdkPlayer;
  deviceId: string;
  api: Pick<SpotifyApi, 'startPlayback'>;
  tapToStart: boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
}

/** Turn a connected SDK player into our ConductorPlayer. Exported so tests can drive it with a fake SDK. */
export const wrapPlayer = ({ sdk, deviceId, api, tapToStart, now, setTimer }: WrapOptions): ConductorPlayer => {
  const listeners = new Set<(s: PlaybackState) => void>();
  const waiters = new Set<(e: { state: PlaybackState } | { autoplayFailed: true }) => void>();
  let activated = !tapToStart;

  sdk.addListener('player_state_changed', (raw) => {
    const s = parsePlayerState(raw, now());
    if (!s) return;
    for (const l of listeners) l(s);
    for (const w of waiters) w({ state: s });
  });
  sdk.addListener('autoplay_failed', () => {
    activated = false;
    for (const w of waiters) w({ autoplayFailed: true });
  });

  const needsTap: PlayResult = { ok: false, issue: 'needs_tap', message: 'Tap play to start the music.' };

  return {
    deviceId,
    tapToStart,

    async activate() {
      await sdk.activateElement();
      activated = true;
    },

    async play(uri, positionMs) {
      if (!activated) return needsTap;
      // Listen before asking, so a state change that beats the HTTP reply is not missed.
      let settle: (r: PlayResult) => void = () => undefined;
      const started = new Promise<PlayResult>((resolve) => {
        const check = (e: { state: PlaybackState } | { autoplayFailed: true }) => {
          if ('autoplayFailed' in e) settle(needsTap);
          else if (!e.state.paused && e.state.track?.uri === uri) settle({ ok: true });
        };
        const cancel = setTimer(() => settle({ ok: false, issue: 'did_not_start', message: 'Spotify did not start the track.' }), START_WAIT_MS);
        settle = (r) => {
          waiters.delete(check);
          cancel();
          resolve(r);
        };
        waiters.add(check);
      });
      try {
        await api.startPlayback(deviceId, uri, positionMs);
      } catch (e) {
        settle({ ok: false, issue: 'rejected', message: e instanceof SpotifyApiError ? e.message : 'Spotify did not start the track.' });
      }
      return started;
    },

    pause: () => sdk.pause(),
    resume: () => sdk.resume(),
    seek: (ms) => sdk.seek(Math.max(0, Math.round(ms))),

    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    disconnect() {
      listeners.clear();
      sdk.disconnect();
    },
  };
};

export type ConnectIssue = 'not_signed_in' | 'no_drm' | 'sdk_unavailable' | 'init_failed' | 'auth_failed' | 'premium_required' | 'transfer_failed';

export type ConnectResult = { ok: true; player: ConductorPlayer } | { ok: false; issue: ConnectIssue; message: string };

const CONNECT_MESSAGES: Record<ConnectIssue, string> = {
  not_signed_in: 'Sign in to Spotify first.',
  no_drm: 'This browser cannot play Spotify (it has no Widevine DRM). Open Kilukkam in your everyday Chrome, Edge, Firefox or Safari, not an automated or embedded browser.',
  sdk_unavailable: 'Could not load the Spotify player. Check the connection.',
  init_failed: 'The Spotify player could not start in this browser. Try your everyday Chrome or Edge, with Premium.',
  auth_failed: 'Spotify sign-in has expired. Sign in again.',
  premium_required: 'Spotify playback in the browser needs a Premium account.',
  transfer_failed: 'Could not move Spotify playback to this laptop.',
};

/**
 * Spotify streams through Widevine. Having the DRM API is not enough (every
 * Chromium has it, including automated ones without the Widevine module), so
 * ask for the key system itself with an audio config Spotify uses.
 */
export const hasWidevine = async (eme: Pick<Navigator, 'requestMediaKeySystemAccess'> | undefined = navigator): Promise<boolean> => {
  if (!eme || typeof eme.requestMediaKeySystemAccess !== 'function') return false;
  try {
    await eme.requestMediaKeySystemAccess('com.widevine.alpha', [
      { initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }] },
    ]);
    return true;
  } catch {
    return false;
  }
};

const failed = (issue: ConnectIssue): ConnectResult => ({ ok: false, issue, message: CONNECT_MESSAGES[issue] });

export interface ConnectOptions {
  auth?: SpotifyAuth;
  api?: SpotifyApi;
  timeoutMs?: number;
  volume?: number;
}

/** Load the SDK, register 'Kilukkam conductor' as a device and make it the active one. */
export const connectPlayer = async (opts: ConnectOptions = {}): Promise<ConnectResult> => {
  const auth = opts.auth ?? spotifyAuth();
  const api = opts.api ?? spotifyApi();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  if (!auth.isLoggedIn()) return failed('not_signed_in');
  if (!(await hasWidevine())) return failed('no_drm');

  let ns: SdkNamespace;
  try {
    ns = await loadSdk(timeoutMs);
  } catch {
    return failed('sdk_unavailable');
  }

  const sdk = new ns.Player({
    name: PLAYER_NAME,
    getOAuthToken: (cb) => {
      void auth.getToken().then((t) => {
        if (t) cb(t);
      });
    },
    volume: opts.volume ?? 0.8,
  });

  const ready = await new Promise<{ deviceId: string } | ConnectIssue>((resolve) => {
    const timer = window.setTimeout(() => resolve('init_failed'), timeoutMs);
    const settle = (v: { deviceId: string } | ConnectIssue) => {
      window.clearTimeout(timer);
      resolve(v);
    };
    sdk.addListener('ready', (p) => {
      const id = isRecord(p) ? nonEmptyString(p['device_id']) : null;
      settle(id ? { deviceId: id } : 'init_failed');
    });
    sdk.addListener('initialization_error', () => settle('init_failed'));
    sdk.addListener('authentication_error', () => settle('auth_failed'));
    sdk.addListener('account_error', () => settle('premium_required'));
    void sdk.connect().then((ok) => {
      if (!ok) settle('init_failed');
    });
  });
  if (typeof ready === 'string') {
    sdk.disconnect();
    return failed(ready);
  }

  try {
    await api.transferPlayback(ready.deviceId);
  } catch {
    sdk.disconnect();
    return failed('transfer_failed');
  }

  return {
    ok: true,
    player: wrapPlayer({
      sdk,
      deviceId: ready.deviceId,
      api,
      tapToStart: needsTapToStart(navigator.userAgent, navigator.maxTouchPoints),
      now: () => Date.now(),
      setTimer: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    }),
  };
};
