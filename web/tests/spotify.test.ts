import { type NoteEvent, type Score, totalBeats, validateScore } from '@kilukkam/shared';
import { describe, expect, it, vi } from 'vitest';
import { type ApiDeps, SpotifyApiError, createSpotifyApi, parsePlaylist, retryAfterMs, spotifyIdFrom } from '../src/lib/spotify/api.js';
import {
  type AuthDeps,
  CALLBACK_PATH,
  SCOPES,
  SpotifyAuth,
  authorizeUrl,
  base64Url,
  challengeFor,
  checkCallback,
  mustHopOrigin,
  parseTokenResponse,
  randomToken,
  redirectUriFor,
  sameSecret,
} from '../src/lib/spotify/auth.js';
import { BANK_NOTES } from '../src/lib/samples.js';
import { buildPlayAlong, chordsFor, drumsPart, padPart, playAlongErrors, triad } from '../src/lib/spotify/playalong.js';
import { type SdkPlayer, needsTapToStart, parsePlayerState, positionAt, wrapPlayer } from '../src/lib/spotify/player.js';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

const loc = (href: string) => {
  const u = new URL(href);
  return { href: u.href, protocol: u.protocol, hostname: u.hostname, port: u.port, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
};

const memoryStore = () => {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('PKCE helpers', () => {
  it('encodes base64url without padding', () => {
    expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8');
    expect(base64Url(new Uint8Array([]))).toBe('');
  });

  it('derives the S256 challenge from RFC 7636 appendix B', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes verifiers of unreserved characters from the random source', () => {
    const v = randomToken(64);
    expect(v).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(randomToken(64)).not.toBe(v);
    expect(randomToken(4, (a) => a.fill(0))).toBe('AAAA');
    expect(randomToken(2, (a) => a.fill(255))).toBe('__');
  });

  it('never redirects to localhost', () => {
    expect(redirectUriFor(loc('http://localhost:5173/play'))).toBe(`http://127.0.0.1:5173${CALLBACK_PATH}`);
    expect(redirectUriFor(loc('http://127.0.0.1:5173/'))).toBe(`http://127.0.0.1:5173${CALLBACK_PATH}`);
    expect(redirectUriFor(loc('https://kilukkam.example/'))).toBe(`https://kilukkam.example${CALLBACK_PATH}`);
    expect(mustHopOrigin(loc('http://localhost:5173/'))).toBe(true);
    expect(mustHopOrigin(loc('https://kilukkam.example/'))).toBe(false);
  });

  it('builds the authorize URL with PKCE, state and the minimal scopes', () => {
    const u = new URL(authorizeUrl({ clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:5173/spotify/callback', challenge: 'abc', state: 'xyz', scopes: SCOPES }));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:5173/spotify/callback',
      code_challenge_method: 'S256',
      code_challenge: 'abc',
      state: 'xyz',
      scope: 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-playback-state',
    });
  });

  it('checks the callback state and code', () => {
    const pending = { verifier: 'v', state: 'good-state', redirectUri: 'r', createdAt: 1000 };
    const cb = (q: string) => new URL(`http://127.0.0.1:5173${CALLBACK_PATH}?${q}`);
    expect(checkCallback(cb('code=c1&state=good-state'), pending, 2000)).toEqual({ ok: true, code: 'c1' });
    expect(checkCallback(cb('code=c1&state=evil'), pending, 2000)).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(checkCallback(cb('code=c1'), pending, 2000)).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(checkCallback(cb('error=access_denied&state=good-state'), pending, 2000)).toEqual({ ok: false, reason: 'denied' });
    expect(checkCallback(cb('state=good-state'), pending, 2000)).toEqual({ ok: false, reason: 'missing_code' });
    expect(checkCallback(cb('code=c1&state=good-state'), null, 2000)).toEqual({ ok: false, reason: 'no_pending_login' });
    expect(checkCallback(cb('code=c1&state=good-state'), pending, 1000 + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' });
    expect(checkCallback(new URL('http://127.0.0.1:5173/?code=c1&state=good-state'), pending, 2000)).toEqual({ ok: false, reason: 'not_callback' });
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });

  it('validates token responses', () => {
    const ok = { access_token: 'A', token_type: 'Bearer', expires_in: 3600, refresh_token: 'R', scope: 'streaming' };
    expect(parseTokenResponse(ok, 0)).toEqual({ accessToken: 'A', refreshToken: 'R', expiresAt: 3_600_000, scope: 'streaming' });
    expect(parseTokenResponse({ ...ok, refresh_token: undefined }, 0, 'OLD')?.refreshToken).toBe('OLD');
    expect(parseTokenResponse({ ...ok, access_token: '' }, 0)).toBeNull();
    expect(parseTokenResponse({ ...ok, token_type: 'mac' }, 0)).toBeNull();
    expect(parseTokenResponse({ ...ok, expires_in: '3600' }, 0)).toBeNull();
    expect(parseTokenResponse('nope', 0)).toBeNull();
  });
});

describe('SpotifyAuth', () => {
  const setup = (href: string, clientId: unknown = CLIENT_ID) => {
    const store = memoryStore();
    let now = 1_000_000;
    const navigate = vi.fn<(url: string) => void>();
    const replaceUrl = vi.fn<(url: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps: AuthDeps = {
      clientId,
      storage: store,
      fetch,
      location: () => loc(href),
      navigate,
      replaceUrl,
      now: () => now,
      random: (a) => crypto.getRandomValues(a),
    };
    return { auth: new SpotifyAuth(deps), store, navigate, replaceUrl, fetch, tick: (ms: number) => (now += ms) };
  };

  it('refuses to start without a valid client id', async () => {
    expect(await setup('http://127.0.0.1:5173/', '').auth.login()).toEqual({ kind: 'unconfigured' });
    expect(await setup('http://127.0.0.1:5173/', 'not-an-id').auth.login()).toEqual({ kind: 'unconfigured' });
  });

  it('hops from localhost to 127.0.0.1 before starting, keeping the page', async () => {
    const { auth, navigate, store } = setup('http://localhost:5173/conduct?room=AB#x');
    expect(await auth.login()).toEqual({ kind: 'moving_to_loopback', to: 'http://127.0.0.1:5173/conduct?room=AB#x' });
    expect(navigate).toHaveBeenCalledWith('http://127.0.0.1:5173/conduct?room=AB#x');
    expect(store.map.size).toBe(0);
  });

  it('runs the whole code flow and refreshes before expiry', async () => {
    const { auth, navigate, replaceUrl, fetch, store, tick } = setup('http://127.0.0.1:5173/');
    expect(await auth.login()).toEqual({ kind: 'redirecting' });
    const authorize = new URL(navigate.mock.calls[0]?.[0] ?? '');
    const state = authorize.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThanOrEqual(32);

    fetch.mockResolvedValueOnce(json({ access_token: 'AT1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT1', scope: SCOPES.join(' ') }));
    expect(await auth.handleCallback(`http://127.0.0.1:5173${CALLBACK_PATH}?code=CODE&state=${state}`)).toBe(true);
    expect(replaceUrl).toHaveBeenCalledWith('/');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('CODE');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5173/spotify/callback');
    expect(await challengeFor(body.get('code_verifier') ?? '')).toBe(authorize.searchParams.get('code_challenge'));
    expect(auth.isLoggedIn()).toBe(true);
    expect(await auth.getToken()).toBe('AT1');

    // The same callback cannot be replayed.
    expect(await auth.handleCallback(`http://127.0.0.1:5173${CALLBACK_PATH}?code=CODE&state=${state}`)).toBe(false);

    tick(3600_000 - 30_000);
    fetch.mockResolvedValueOnce(json({ access_token: 'AT2', token_type: 'Bearer', expires_in: 3600 }));
    const [a, b] = await Promise.all([auth.getToken(), auth.getToken()]);
    expect([a, b]).toEqual(['AT2', 'AT2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const refreshBody = new URLSearchParams(String(fetch.mock.calls[1]?.[1]?.body));
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('RT1');

    // The refresh kept the refresh token it was not sent a replacement for.
    tick(3600_000);
    fetch.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    expect(await auth.getToken()).toBeNull();
    expect(new URLSearchParams(String(fetch.mock.calls[2]?.[1]?.body)).get('refresh_token')).toBe('RT1');
    expect(auth.isLoggedIn()).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('rejects a callback with the wrong state without calling Spotify', async () => {
    const { auth, fetch } = setup('http://127.0.0.1:5173/');
    await auth.login();
    expect(await auth.handleCallback(`http://127.0.0.1:5173${CALLBACK_PATH}?code=CODE&state=forged`)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('ignores pages that are not the callback', async () => {
    const { auth, replaceUrl } = setup('http://127.0.0.1:5173/');
    expect(await auth.handleCallback('http://127.0.0.1:5173/?code=x')).toBe(false);
    expect(await auth.handleCallback('not a url')).toBe(false);
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it('logs out by forgetting everything', async () => {
    const { auth, store } = setup('http://127.0.0.1:5173/');
    await auth.login();
    auth.logout();
    expect(store.map.size).toBe(0);
  });
});

const spotifyTrack = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id,
  name: `Song ${id.slice(0, 3)}`,
  uri: `spotify:track:${id}`,
  duration_ms: 200_000,
  artists: [{ name: 'Artist' }, { nope: true }],
  album: {
    images: [
      { url: 'https://i.scdn.co/640', width: 640 },
      { url: 'https://i.scdn.co/300', width: 300 },
      { url: 'javascript:alert(1)', width: 300 },
    ],
  },
  is_playable: true,
  ...extra,
});

describe('Spotify API', () => {
  const setup = (responses: (Response | Error)[], refreshTo: string | null = 'FRESH') => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const refresh = vi.fn(async () => refreshTo);
    const deps: ApiDeps = { getToken: async () => 'SECRET_TOKEN', refresh, fetch, sleep, now: () => 0 };
    return { api: createSpotifyApi(deps), fetch, sleep, refresh };
  };

  const auth = (call: unknown[] | undefined): string | undefined => {
    const init = call?.[1];
    if (typeof init !== 'object' || init === null || !('headers' in init)) return undefined;
    const h: unknown = init.headers;
    return typeof h === 'object' && h !== null && 'Authorization' in h && typeof h.Authorization === 'string' ? h.Authorization : undefined;
  };

  it('reads the signed-in user', async () => {
    const { api, fetch } = setup([json({ id: 'u1', display_name: 'Maya', product: 'premium' })]);
    expect(await api.me()).toEqual({ id: 'u1', displayName: 'Maya', product: 'premium' });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/me');
    expect(auth(fetch.mock.calls[0])).toBe('Bearer SECRET_TOKEN');
  });

  it('lists playlists with either size field and validates paging', async () => {
    const { api, fetch } = setup([
      json({
        items: [
          { id: PLAYLIST_ID, name: 'Party', owner: { display_name: 'Maya' }, images: [{ url: 'https://i.scdn.co/p' }], items: { total: 42 } },
          { id: '1'.repeat(22), name: 'Old shape', owner: { id: 'u2' }, images: null, tracks: { total: 7 } },
          { id: 'bad id', name: 'Dropped' },
          null,
        ],
        total: 30,
        next: 'https://api.spotify.com/v1/me/playlists?offset=4',
      }),
    ]);
    const page = await api.myPlaylists(4, 0);
    expect(page.items).toEqual([
      { id: PLAYLIST_ID, name: 'Party', owner: 'Maya', image: 'https://i.scdn.co/p', trackCount: 42 },
      { id: '1'.repeat(22), name: 'Old shape', owner: 'u2', image: null, trackCount: 7 },
    ]);
    expect(page.nextOffset).toBe(4);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/me/playlists?limit=4&offset=0');
    await expect(api.myPlaylists(51, 0)).rejects.toMatchObject({ kind: 'bad_input' });
    await expect(api.myPlaylists(10, -1)).rejects.toMatchObject({ kind: 'bad_input' });
    expect(parsePlaylist({ id: PLAYLIST_ID, name: '' })).toBeNull();
  });

  it('pages through /playlists/{id}/items, keeping only playable song tracks', async () => {
    const page1: { item: unknown }[] = Array.from({ length: 50 }, (_, i) => ({ item: spotifyTrack(`${String(i).padStart(2, '0')}${'a'.repeat(20)}`) }));
    page1[1] = { item: { ...spotifyTrack('b'.repeat(22)), type: 'episode' } };
    page1[2] = { item: { ...spotifyTrack('c'.repeat(22)), is_local: true } };
    const { api, fetch } = setup([
      json({ items: page1, total: 52, next: 'https://api.spotify.com/v1/x' }),
      json({ items: [{ track: spotifyTrack('d'.repeat(22), { is_playable: false }) }, { item: null }], total: 52, next: null }),
    ]);
    const tracks = await api.playlistItems(PLAYLIST_ID);
    expect(tracks).toHaveLength(49);
    expect(tracks[0]).toEqual({
      id: `00${'a'.repeat(20)}`,
      name: 'Song 00a',
      artists: ['Artist'],
      durationMs: 200_000,
      albumArt: 'https://i.scdn.co/300',
      uri: `spotify:track:00${'a'.repeat(20)}`,
      isPlayable: true,
    });
    expect(tracks[48]?.isPlayable).toBe(false);
    const urls = fetch.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.map((u) => u.pathname)).toEqual([`/v1/playlists/${PLAYLIST_ID}/items`, `/v1/playlists/${PLAYLIST_ID}/items`]);
    expect(urls.map((u) => u.searchParams.get('offset'))).toEqual(['0', '50']);
    expect(urls[0]?.searchParams.get('market')).toBe('from_token');
  });

  it('refuses ids that could change the request path', async () => {
    const { api, fetch } = setup([]);
    await expect(api.playlistItems('../me/player')).rejects.toMatchObject({ kind: 'bad_input' });
    await expect(api.track(`${TRACK_ID}?x=1`)).rejects.toMatchObject({ kind: 'bad_input' });
    await expect(api.startPlayback('dev', 'spotify:episode:x', 0)).rejects.toMatchObject({ kind: 'bad_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads one track and rejects malformed ones', async () => {
    const { api } = setup([json(spotifyTrack(TRACK_ID)), json({ ...spotifyTrack(TRACK_ID), duration_ms: 'long' })]);
    expect((await api.track(TRACK_ID)).uri).toBe(`spotify:track:${TRACK_ID}`);
    await expect(api.track(TRACK_ID)).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('refreshes once on 401, then gives up', async () => {
    const ok = setup([json({}, 401), json({ id: 'u1' })]);
    expect((await ok.api.me()).id).toBe('u1');
    expect(ok.refresh).toHaveBeenCalledTimes(1);
    expect(auth(ok.fetch.mock.calls[1])).toBe('Bearer FRESH');

    const twice = setup([json({}, 401), json({}, 401)]);
    await expect(twice.api.me()).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(twice.refresh).toHaveBeenCalledTimes(1);

    const noRefresh = setup([json({}, 401)], null);
    await expect(noRefresh.api.me()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('waits out Retry-After on 429, and reports long waits instead of freezing', async () => {
    const short = setup([new Response(null, { status: 429, headers: { 'Retry-After': '2' } }), json({ id: 'u1' })]);
    expect((await short.api.me()).id).toBe('u1');
    expect(short.sleep).toHaveBeenCalledWith(2000);

    const long = setup([new Response(null, { status: 429, headers: { 'Retry-After': '120' } })]);
    await expect(long.api.me()).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 120_000 });
    expect(long.sleep).not.toHaveBeenCalled();

    const forever = setup([429, 429, 429].map((s) => new Response(null, { status: s, headers: { 'Retry-After': '1' } })));
    await expect(forever.api.me()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(forever.sleep).toHaveBeenCalledTimes(2);
  });

  it('maps failures to safe messages that never carry the token', async () => {
    const cases: [Response | Error, string][] = [
      [new TypeError('Failed to fetch SECRET_TOKEN'), 'network'],
      [json({ error: { message: 'Bearer SECRET_TOKEN rejected' } }, 403), 'forbidden'],
      [json({}, 404), 'not_found'],
      [json({}, 502), 'server'],
      [new Response('not json', { status: 200 }), 'bad_response'],
    ];
    for (const [res, kind] of cases) {
      const { api } = setup([res]);
      const err = await api.me().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SpotifyApiError);
      if (!(err instanceof SpotifyApiError)) continue;
      expect(err.kind).toBe(kind);
      expect(err.message).not.toContain('SECRET_TOKEN');
      expect(err.message).not.toContain('Bearer');
    }
  });

  it('transfers and starts playback on our device', async () => {
    const { api, fetch } = setup([new Response(null, { status: 204 }), new Response(null, { status: 204 })]);
    await api.transferPlayback('dev1');
    await api.startPlayback('dev1', `spotify:track:${TRACK_ID}`, 1234.6);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ device_ids: ['dev1'], play: false });
    expect(fetch.mock.calls[1]?.[0]).toBe('https://api.spotify.com/v1/me/player/play?device_id=dev1');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ uris: [`spotify:track:${TRACK_ID}`], position_ms: 1235 });
  });

  it('parses pasted links and Retry-After', () => {
    expect(spotifyIdFrom(PLAYLIST_ID, 'playlist')).toBe(PLAYLIST_ID);
    expect(spotifyIdFrom(`spotify:playlist:${PLAYLIST_ID}`, 'playlist')).toBe(PLAYLIST_ID);
    expect(spotifyIdFrom(` https://open.spotify.com/intl-en/playlist/${PLAYLIST_ID}?si=abc `, 'playlist')).toBe(PLAYLIST_ID);
    expect(spotifyIdFrom(`https://evil.example/playlist/${PLAYLIST_ID}`, 'playlist')).toBeNull();
    expect(spotifyIdFrom(`spotify:track:${TRACK_ID}`, 'playlist')).toBeNull();
    expect(retryAfterMs('3', 0)).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(retryAfterMs('soon', 0)).toBeNull();
  });
});

describe('player', () => {
  const sdkState = (paused: boolean, uri = `spotify:track:${TRACK_ID}`) => ({
    paused,
    position: 1000,
    duration: 200_000,
    timestamp: 50_000,
    track_window: { current_track: { uri, name: 'Song', artists: [{ name: 'A' }], album: { images: [{ url: 'https://i.scdn.co/x' }] } } },
  });

  it('validates SDK state and extrapolates the position', () => {
    const s = parsePlayerState(sdkState(false), 0);
    expect(s).toEqual({
      positionMs: 1000,
      durationMs: 200_000,
      paused: false,
      track: { uri: `spotify:track:${TRACK_ID}`, name: 'Song', artists: ['A'], albumArt: 'https://i.scdn.co/x' },
      sampledAt: 50_000,
    });
    if (!s) return;
    expect(positionAt(s, 50_500)).toBe(1500);
    expect(positionAt({ ...s, paused: true }, 50_500)).toBe(1000);
    expect(positionAt(s, 10_000_000)).toBe(200_000);
    expect(parsePlayerState(null, 0)).toBeNull();
    expect(parsePlayerState({ paused: 'no', position: 1, duration: 2 }, 0)).toBeNull();
    expect(parsePlayerState({ paused: true, position: 1, duration: 2 }, 7)).toMatchObject({ track: null, sampledAt: 7 });
  });

  it('knows which browsers need a tap to start audio', () => {
    expect(needsTapToStart('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 5)).toBe(true);
    expect(needsTapToStart('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 5)).toBe(true);
    expect(needsTapToStart('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 0)).toBe(true);
    expect(needsTapToStart('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36', 0)).toBe(false);
    expect(needsTapToStart('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 0)).toBe(false);
  });

  const fakeSdk = () => {
    const handlers = new Map<string, (p: unknown) => void>();
    const sdk: SdkPlayer = {
      connect: async () => true,
      disconnect: vi.fn(),
      addListener: (e, cb) => {
        handlers.set(e, cb);
        return true;
      },
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      seek: vi.fn(async (_ms: number) => undefined),
      activateElement: vi.fn(async () => undefined),
    };
    return { sdk, emit: (e: string, p: unknown) => handlers.get(e)?.(p) };
  };

  const make = (tapToStart: boolean, startPlayback: (d: string, u: string, p: number) => Promise<void>) => {
    const { sdk, emit } = fakeSdk();
    const timers: (() => void)[] = [];
    const player = wrapPlayer({
      sdk,
      deviceId: 'dev1',
      api: { startPlayback },
      tapToStart,
      now: () => 0,
      setTimer: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    return { player, sdk, emit, fireTimers: () => timers.forEach((t) => t()) };
  };

  const uri = `spotify:track:${TRACK_ID}`;

  it('asks for a tap first where the browser needs one', async () => {
    const start = vi.fn(async () => undefined);
    const { player, sdk, emit } = make(true, start);
    expect(await player.play(uri, 0)).toMatchObject({ ok: false, issue: 'needs_tap' });
    expect(start).not.toHaveBeenCalled();
    await player.activate();
    expect(sdk.activateElement).toHaveBeenCalled();
    const playing = player.play(uri, 500);
    await Promise.resolve();
    emit('player_state_changed', sdkState(false));
    expect(await playing).toEqual({ ok: true });
    expect(start).toHaveBeenCalledWith('dev1', uri, 500);
  });

  it('reports autoplay refusals, API errors and silent failures', async () => {
    const blocked = make(false, async () => undefined);
    const p1 = blocked.player.play(uri, 0);
    await Promise.resolve();
    blocked.emit('autoplay_failed', {});
    expect(await p1).toMatchObject({ ok: false, issue: 'needs_tap' });
    expect(await blocked.player.play(uri, 0)).toMatchObject({ ok: false, issue: 'needs_tap' });

    const rejected = make(false, async () => {
      throw new SpotifyApiError('forbidden', 'Spotify refused this.');
    });
    expect(await rejected.player.play(uri, 0)).toEqual({ ok: false, issue: 'rejected', message: 'Spotify refused this.' });

    const silent = make(false, async () => undefined);
    const p3 = silent.player.play(uri, 0);
    await Promise.resolve();
    silent.emit('player_state_changed', sdkState(false, 'spotify:track:other'));
    silent.fireTimers();
    expect(await p3).toMatchObject({ ok: false, issue: 'did_not_start' });
  });

  it('forwards state and controls', async () => {
    const { player, sdk, emit } = make(false, async () => undefined);
    const seen: boolean[] = [];
    const off = player.onState((s) => seen.push(s.paused));
    emit('player_state_changed', sdkState(true));
    emit('player_state_changed', { junk: true });
    off();
    emit('player_state_changed', sdkState(false));
    expect(seen).toEqual([true]);
    await player.seek(-5);
    expect(sdk.seek).toHaveBeenCalledWith(0);
    await player.pause();
    await player.resume();
    expect(sdk.pause).toHaveBeenCalled();
    expect(sdk.resume).toHaveBeenCalled();
    player.disconnect();
    expect(sdk.disconnect).toHaveBeenCalled();
  });
});

describe('play-along score', () => {
  const notesOf = (score: Score, id: string): NoteEvent[] =>
    (score.tracks.find((t) => t.id === id)?.events ?? []).filter((e): e is NoteEvent => e.kind === 'note');

  const inRange = (score: Score): void => {
    for (const t of score.tracks) {
      const bank = BANK_NOTES[t.instrument];
      for (const n of notesOf(score, t.id)) {
        expect(n.midi).toBeGreaterThanOrEqual(Math.min(...bank));
        expect(n.midi).toBeLessThanOrEqual(Math.max(...bank));
      }
    }
  };

  for (const beatsPerBar of [3, 4, 6]) {
    for (const key of [null, { tonic: 0, mode: 'major' as const }, { tonic: 9, mode: 'minor' as const }, { tonic: 6, mode: 'major' as const }]) {
      it(`is valid in ${beatsPerBar}/4 with ${key ? `key ${key.tonic} ${key.mode}` : 'no key'}`, () => {
        const score = buildPlayAlong({ bpm: 123.4, beatsPerBar, bars: 9, key });
        expect(validateScore(score)).toEqual([]);
        expect(score.tracks.map((t) => t.id)).toEqual(key ? ['drums', 'claps', 'bass', 'pad'] : ['drums', 'claps']);
        // Monophonic parts, each exactly as long as the piece.
        for (const t of score.tracks) expect(totalBeats(t.events)).toBe(beatsPerBar * 9);
        expect(score.tracks.reduce((n, t) => n + t.maxPlayers, 0)).toBeLessThanOrEqual(100);
        inRange(score);
      });
    }
  }

  it('writes kick on 1 and 3, snare on 2 and 4, hats on the off beats', () => {
    const bar = drumsPart(4, 1).map((e) => (e.kind === 'note' ? e.midi : 0));
    expect(bar).toEqual([37, 53, 45, 53, 37, 53, 45, 53]);
    const waltz = drumsPart(3, 1).filter((_, i) => i % 2 === 0).map((e) => (e.kind === 'note' ? e.midi : 0));
    expect(waltz).toEqual([37, 45, 45]);
  });

  it('claps on the backbeats with a shaker pickup', () => {
    const claps = buildPlayAlong({ bpm: 120, beatsPerBar: 4, bars: 1 }).tracks[1]?.events ?? [];
    expect(claps.map((e) => (e.kind === 'note' ? `n${e.midi}:${e.beats}` : `r:${e.beats}`))).toEqual(['r:1', 'n72:0.5', 'r:1.5', 'n72:0.5', 'n79:0.5']);
  });

  it('plays I V vi IV, with the bass on the roots', () => {
    const cMajor = { tonic: 0, mode: 'major' as const };
    expect(chordsFor(cMajor, 5)).toEqual([
      [0, 4, 7],
      [7, 11, 2],
      [9, 0, 4],
      [5, 9, 0],
      [0, 4, 7],
    ]);
    expect(triad({ tonic: 9, mode: 'minor' }, 0)).toEqual([9, 0, 4]);
    const score = buildPlayAlong({ bpm: 100, beatsPerBar: 4, bars: 4, key: cMajor });
    expect(notesOf(score, 'bass').map((n) => n.midi % 12)).toEqual([0, 0, 7, 7, 9, 9, 5, 5]);
  });

  it('moves the pad by small steps between chord tones', () => {
    const key = { tonic: 2, mode: 'major' as const };
    const pad = padPart(key, 4, 16).filter((e): e is NoteEvent => e.kind === 'note');
    const chords = chordsFor(key, 16);
    pad.forEach((n, i) => expect(chords[i]).toContain(n.midi % 12));
    expect(pad[0]?.midi !== undefined && pad[0].midi % 12).toBe(6);
    for (let i = 1; i < pad.length; i++) expect(Math.abs((pad[i]?.midi ?? 0) - (pad[i - 1]?.midi ?? 0))).toBeLessThanOrEqual(5);
  });

  it('rejects input it cannot build', () => {
    expect(playAlongErrors({ bpm: 120, beatsPerBar: 4, bars: 8 })).toEqual([]);
    expect(playAlongErrors({ bpm: 0, beatsPerBar: 4.5, bars: 0, key: { tonic: 12, mode: 'major' } })).toHaveLength(4);
    expect(() => buildPlayAlong({ bpm: Number.NaN, beatsPerBar: 4, bars: 8 })).toThrow(RangeError);
  });
});
