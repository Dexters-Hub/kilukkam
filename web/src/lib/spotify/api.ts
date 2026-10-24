import { spotifyAuth } from './auth.js';
import { finiteNumber, httpsUrl, isRecord, nonEmptyString } from './json.js';

// Typed Spotify Web API calls for the conductor. Every response is validated
// into our own small types; anything malformed is dropped or reported, never
// cast through. Errors carry a kind and a message safe to show on screen:
// no token, header or request URL ever ends up in one.
//
// Development Mode notes: the playlist contents endpoint is
// /v1/playlists/{id}/items (the /tracks paths are deprecated), and a 403
// usually means the signed-in account is not one of the app's 5 users or
// has no Premium.

export const API_BASE = 'https://api.spotify.com/v1';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  durationMs: number;
  /** https URL of the album cover closest to 300px, if Spotify has one */
  albumArt: string | null;
  uri: string;
  /** False when Spotify says this track cannot play in the account's market */
  isPlayable: boolean;
}

export interface SpotifyUser {
  id: string;
  displayName: string;
  /** 'premium', 'free', ...; null when Spotify leaves it out */
  product: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: string;
  image: string | null;
  trackCount: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** Offset for the next page, or null at the end */
  nextOffset: number | null;
}

export type ApiErrorKind = 'auth' | 'forbidden' | 'not_found' | 'rate_limited' | 'network' | 'server' | 'bad_response' | 'bad_input';

export class SpotifyApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Set when rate limited: how long Spotify asked us to wait */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

const MESSAGES: Record<ApiErrorKind, string> = {
  auth: 'Spotify sign-in has expired. Sign in again.',
  forbidden: 'Spotify refused this. The account needs Premium and must be on the app user list.',
  not_found: 'Spotify could not find that.',
  rate_limited: 'Spotify is busy. Try again in a moment.',
  network: 'Could not reach Spotify. Check the connection.',
  server: 'Spotify had a problem. Try again in a moment.',
  bad_response: 'Spotify sent something unexpected.',
  bad_input: 'That is not a Spotify link or ID.',
};

const fail = (kind: ApiErrorKind, status: number | null = null, retryAfterMs: number | null = null): SpotifyApiError =>
  new SpotifyApiError(kind, MESSAGES[kind], status, retryAfterMs);

// Pure parsing

/** Spotify IDs are 22 base62 characters; checking them keeps request paths ours. */
export const isSpotifyId = (v: string): boolean => /^[0-9A-Za-z]{22}$/.test(v);

/** Accept a bare ID, a spotify:<kind>:<id> URI or an open.spotify.com link, as pasted by the conductor. */
export const spotifyIdFrom = (input: string, kind: 'playlist' | 'track'): string | null => {
  const s = input.trim();
  if (isSpotifyId(s)) return s;
  const uri = new RegExp(`^spotify:${kind}:([0-9A-Za-z]{22})$`).exec(s);
  if (uri?.[1]) return uri[1];
  try {
    const url = new URL(s);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const at = parts.indexOf(kind);
    const id = at >= 0 ? parts[at + 1] : undefined;
    return id !== undefined && isSpotifyId(id) ? id : null;
  } catch {
    return null;
  }
};

/** Retry-After is seconds or an HTTP date. Null when absent or unreadable. */
export const retryAfterMs = (header: string | null, now: number): number | null => {
  if (header === null || header.trim() === '') return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
};

const pickImage = (images: unknown): string | null => {
  if (!Array.isArray(images)) return null;
  let best: { url: string; d: number } | null = null;
  for (const img of images) {
    if (!isRecord(img)) continue;
    const url = httpsUrl(img['url']);
    if (!url) continue;
    const d = Math.abs((finiteNumber(img['width']) ?? 300) - 300);
    if (!best || d < best.d) best = { url, d };
  }
  return best?.url ?? null;
};

/** A playable Spotify track, or null for episodes, local files, removed items and malformed JSON. */
export const parseTrack = (json: unknown): SpotifyTrack | null => {
  if (!isRecord(json)) return null;
  if (json['type'] !== undefined && json['type'] !== 'track') return null;
  if (json['is_local'] === true) return null;
  const id = nonEmptyString(json['id']);
  const name = nonEmptyString(json['name']);
  const uri = nonEmptyString(json['uri']);
  const durationMs = finiteNumber(json['duration_ms']);
  if (!id || !isSpotifyId(id) || !name || !uri || uri !== `spotify:track:${id}` || durationMs === null || durationMs <= 0) return null;
  const artists = Array.isArray(json['artists'])
    ? json['artists'].flatMap((a: unknown) => {
        const n = isRecord(a) ? nonEmptyString(a['name']) : null;
        return n ? [n] : [];
      })
    : [];
  const album = json['album'];
  return {
    id,
    name,
    artists,
    durationMs,
    albumArt: isRecord(album) ? pickImage(album['images']) : null,
    uri,
    isPlayable: json['is_playable'] !== false,
  };
};

export const parseUser = (json: unknown): SpotifyUser | null => {
  if (!isRecord(json)) return null;
  const id = nonEmptyString(json['id']);
  if (!id) return null;
  return { id, displayName: nonEmptyString(json['display_name']) ?? id, product: nonEmptyString(json['product']) };
};

/** Playlists report their size under `items` now and under `tracks` in older responses; accept either. */
export const parsePlaylist = (json: unknown): SpotifyPlaylist | null => {
  if (!isRecord(json)) return null;
  const id = nonEmptyString(json['id']);
  const name = nonEmptyString(json['name']);
  if (!id || !isSpotifyId(id) || name === null) return null;
  const owner = json['owner'];
  const sized = isRecord(json['items']) ? json['items'] : isRecord(json['tracks']) ? json['tracks'] : null;
  return {
    id,
    name,
    owner: (isRecord(owner) && (nonEmptyString(owner['display_name']) ?? nonEmptyString(owner['id']))) || '',
    image: pickImage(json['images']),
    trackCount: Math.max(0, finiteNumber(sized?.['total']) ?? 0),
  };
};

/** One page envelope; `parse` drops items it cannot use. */
export const parsePage = <T>(json: unknown, offset: number, parse: (item: unknown) => T | null): Page<T> | null => {
  if (!isRecord(json) || !Array.isArray(json['items'])) return null;
  const raw: unknown[] = json['items'];
  const total = finiteNumber(json['total']) ?? raw.length;
  const items = raw.flatMap((i) => {
    const p = parse(i);
    return p === null ? [] : [p];
  });
  const reached = offset + raw.length;
  return { items, total, nextOffset: json['next'] !== null && json['next'] !== undefined && raw.length > 0 && reached < total ? reached : null };
};

/** A playlist entry wraps its track under `item` (current API) or `track` (older responses). */
export const parsePlaylistEntry = (json: unknown): SpotifyTrack | null =>
  isRecord(json) ? parseTrack(json['item'] !== undefined ? json['item'] : json['track']) : null;

// The client

export interface ApiDeps {
  getToken: () => Promise<string | null>;
  /** Fresh token after a 401, or null when the session cannot be renewed */
  refresh: () => Promise<string | null>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Waits longer than this are reported instead of slept through: the conductor should not stare at a frozen screen. */
const MAX_RETRY_WAIT_MS = 10_000;
const MAX_RATE_RETRIES = 2;
const PAGE_SIZE = 50;
/** Enough for any party playlist; stops a runaway loop on a huge one */
const MAX_PLAYLIST_ITEMS = 1000;

export interface RequestOptions {
  method?: 'GET' | 'PUT';
  query?: Record<string, string>;
  body?: unknown;
}

export const createSpotifyApi = (deps: ApiDeps) => {
  /** One call with the 401 and 429 rules applied. Resolves to the JSON body, or null for an empty reply. */
  const request = async (path: string, opts: RequestOptions = {}): Promise<unknown> => {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    let token = await deps.getToken();
    if (!token) throw fail('auth');
    let refreshed = false;
    let rateRetries = 0;
    for (;;) {
      let res: Response;
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const init: RequestInit = { method: opts.method ?? 'GET', headers };
        if (opts.body !== undefined) {
          headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(opts.body);
        }
        res = await deps.fetch(url.toString(), init);
      } catch {
        throw fail('network');
      }
      if (res.status === 401) {
        if (refreshed) throw fail('auth', 401);
        refreshed = true;
        token = await deps.refresh();
        if (!token) throw fail('auth', 401);
        continue;
      }
      if (res.status === 429) {
        const wait = retryAfterMs(res.headers.get('Retry-After'), deps.now()) ?? 1000;
        if (rateRetries >= MAX_RATE_RETRIES || wait > MAX_RETRY_WAIT_MS) throw fail('rate_limited', 429, wait);
        rateRetries++;
        await deps.sleep(wait);
        continue;
      }
      if (res.status === 403) throw fail('forbidden', 403);
      if (res.status === 404) throw fail('not_found', 404);
      if (res.status >= 500) throw fail('server', res.status);
      if (!res.ok) throw fail('bad_response', res.status);
      if (res.status === 204) return null;
      const text = await res.text();
      if (text.trim() === '') return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw fail('bad_response', res.status);
      }
    }
  };

  const needId = (id: string): string => {
    if (!isSpotifyId(id)) throw fail('bad_input');
    return id;
  };

  return {
    async me(): Promise<SpotifyUser> {
      const user = parseUser(await request('/me'));
      if (!user) throw fail('bad_response');
      return user;
    },

    async myPlaylists(limit = 20, offset = 0): Promise<Page<SpotifyPlaylist>> {
      if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE || !Number.isInteger(offset) || offset < 0) throw fail('bad_input');
      const page = parsePage(await request('/me/playlists', { query: { limit: String(limit), offset: String(offset) } }), offset, parsePlaylist);
      if (!page) throw fail('bad_response');
      return page;
    },

    /** Every playable track in a playlist, paged by offset (we never follow a `next` URL Spotify hands us). */
    async playlistItems(playlistId: string): Promise<SpotifyTrack[]> {
      const id = needId(playlistId);
      const tracks: SpotifyTrack[] = [];
      let offset: number | null = 0;
      while (offset !== null && offset < MAX_PLAYLIST_ITEMS) {
        const json: unknown = await request(`/playlists/${id}/items`, {
          query: { limit: String(PAGE_SIZE), offset: String(offset), market: 'from_token', additional_types: 'track' },
        });
        const page: Page<SpotifyTrack> | null = parsePage(json, offset, parsePlaylistEntry);
        if (!page) throw fail('bad_response');
        tracks.push(...page.items);
        offset = page.nextOffset;
      }
      return tracks;
    },

    async track(trackId: string): Promise<SpotifyTrack> {
      const t = parseTrack(await request(`/tracks/${needId(trackId)}`, { query: { market: 'from_token' } }));
      if (!t) throw fail('bad_response');
      return t;
    },

    /** Make the browser player the active Spotify device, without starting playback. */
    async transferPlayback(deviceId: string): Promise<void> {
      await request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: false } });
    },

    /** Start `uri` on our device at `positionMs`. */
    async startPlayback(deviceId: string, uri: string, positionMs: number): Promise<void> {
      if (!/^spotify:track:[0-9A-Za-z]{22}$/.test(uri)) throw fail('bad_input');
      await request('/me/player/play', {
        method: 'PUT',
        query: { device_id: deviceId },
        body: { uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) },
      });
    },
  };
};

export type SpotifyApi = ReturnType<typeof createSpotifyApi>;

let shared: SpotifyApi | null = null;

/** The app-wide client, signed in through `auth.ts`. */
export const spotifyApi = (): SpotifyApi => {
  if (!shared) {
    const auth = spotifyAuth();
    shared = createSpotifyApi({
      getToken: () => auth.getToken(),
      refresh: () => auth.refresh(),
      fetch: (input, init) => window.fetch(input, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
    });
  }
  return shared;
};

export const me = (): Promise<SpotifyUser> => spotifyApi().me();
export const myPlaylists = (limit?: number, offset?: number): Promise<Page<SpotifyPlaylist>> => spotifyApi().myPlaylists(limit, offset);
export const playlistItems = (id: string): Promise<SpotifyTrack[]> => spotifyApi().playlistItems(id);
export const track = (id: string): Promise<SpotifyTrack> => spotifyApi().track(id);
