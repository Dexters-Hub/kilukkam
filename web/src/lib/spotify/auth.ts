import { isRecord, safeJson } from './json.js';

// Spotify sign-in for the conductor only (players never touch Spotify).
// Authorization Code with PKCE: no client secret exists anywhere, the code
// verifier never leaves this tab, and the state parameter ties the callback
// to the login this tab started (CSRF). Tokens live in sessionStorage, so
// they die with the tab and never reach another origin or a later visitor.
//
// Spotify rejects 'localhost' redirect URIs; it accepts the loopback address
// 127.0.0.1 instead. sessionStorage is per origin, so a login that starts on
// localhost first hops the tab to the same page on 127.0.0.1 and asks the
// conductor to tap again there: the verifier must be saved on the origin the
// callback lands on.

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const CALLBACK_PATH = '/spotify/callback';

/** The least the play-along needs: stream in the browser, read playlists, steer playback. */
export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-modify-playback-state',
  'user-read-playback-state',
] as const;

const TOKENS_KEY = 'kilukkam.spotify.tokens';
const PENDING_KEY = 'kilukkam.spotify.pending';
/** A login left unfinished this long is abandoned */
const PENDING_TTL_MS = 10 * 60_000;
/** Refresh this long before Spotify says the token expires, so a request never races the expiry */
const EXPIRY_SKEW_MS = 60_000;

// Pure helpers

/** Spotify Client IDs are 32 hex characters. */
export const isClientId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v);

/** RFC 4648 base64url without padding. */
export const base64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** 64 symbols, so `byte & 63` picks one with no modulo bias. All are RFC 7636 unreserved characters. */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A PKCE code verifier or state value: `length` random unreserved characters (verifiers need 43 to 128). */
export const randomToken = (length: number, fill: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string => {
  const bytes = fill(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += VERIFIER_ALPHABET[b & 63] ?? '';
  return out;
};

/** S256 code challenge: base64url(SHA-256(verifier)). */
export const challengeFor = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
};

export interface PageLocation {
  protocol: string;
  hostname: string;
  port: string;
  origin: string;
}

/** The origin Spotify will accept a redirect to: localhost becomes the loopback address. */
export const callbackOrigin = (loc: PageLocation): string =>
  loc.hostname === 'localhost' ? `http://127.0.0.1${loc.port ? `:${loc.port}` : ''}` : loc.origin;

/** The redirect URI registered in the Spotify dashboard for this page. */
export const redirectUriFor = (loc: PageLocation): string => `${callbackOrigin(loc)}${CALLBACK_PATH}`;

/** True when the page must move to 127.0.0.1 before a login can complete on the same origin. */
export const mustHopOrigin = (loc: PageLocation): boolean => callbackOrigin(loc) !== loc.origin;

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes: readonly string[];
}

export const authorizeUrl = ({ clientId, redirectUri, challenge, state, scopes }: AuthorizeParams): string => {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: scopes.join(' '),
  }).toString();
  return url.toString();
};

/** Compare without stopping at the first different character, so timing reveals nothing about the expected state. */
export const sameSecret = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export interface PendingLogin {
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

export type CallbackCheck =
  | { ok: true; code: string }
  | { ok: false; reason: 'not_callback' | 'no_pending_login' | 'expired' | 'state_mismatch' | 'denied' | 'missing_code' };

/** Decide whether a callback URL completes the pending login. Never trusts the URL beyond these checks. */
export const checkCallback = (url: URL, pending: PendingLogin | null, now: number): CallbackCheck => {
  if (url.pathname !== CALLBACK_PATH) return { ok: false, reason: 'not_callback' };
  if (!pending) return { ok: false, reason: 'no_pending_login' };
  if (now - pending.createdAt > PENDING_TTL_MS) return { ok: false, reason: 'expired' };
  const state = url.searchParams.get('state');
  if (state === null || !sameSecret(state, pending.state)) return { ok: false, reason: 'state_mismatch' };
  if (url.searchParams.has('error')) return { ok: false, reason: 'denied' };
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, reason: 'missing_code' };
  return { ok: true, code };
};

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms after which the access token is no longer valid */
  expiresAt: number;
  scope: string;
}

/**
 * Validate the token endpoint's JSON. A refresh may omit the refresh token,
 * in which case the one we already hold stays valid.
 */
export const parseTokenResponse = (json: unknown, now: number, previousRefresh: string | null = null): Tokens | null => {
  if (!isRecord(json)) return null;
  const { access_token, token_type, expires_in, refresh_token, scope } = json;
  if (typeof access_token !== 'string' || access_token.length === 0) return null;
  if (typeof token_type !== 'string' || token_type.toLowerCase() !== 'bearer') return null;
  if (typeof expires_in !== 'number' || !Number.isFinite(expires_in) || expires_in <= 0) return null;
  const refreshToken = typeof refresh_token === 'string' && refresh_token.length > 0 ? refresh_token : previousRefresh;
  return { accessToken: access_token, refreshToken, expiresAt: now + expires_in * 1000, scope: typeof scope === 'string' ? scope : '' };
};

export const parseStoredTokens = (raw: string | null): Tokens | null => {
  const json = safeJson(raw);
  if (!isRecord(json)) return null;
  const { accessToken, refreshToken, expiresAt, scope } = json;
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'number' || typeof scope !== 'string') return null;
  if (refreshToken !== null && typeof refreshToken !== 'string') return null;
  return { accessToken, refreshToken, expiresAt, scope };
};

export const parsePending = (raw: string | null): PendingLogin | null => {
  const json = safeJson(raw);
  if (!isRecord(json)) return null;
  const { verifier, state, redirectUri, createdAt } = json;
  if (typeof verifier !== 'string' || typeof state !== 'string' || typeof redirectUri !== 'string' || typeof createdAt !== 'number') return null;
  return { verifier, state, redirectUri, createdAt };
};

/** Usable now, allowing for the skew. */
export const isFresh = (t: Tokens, now: number): boolean => t.expiresAt - EXPIRY_SKEW_MS > now;

// The stateful client, with every browser dependency injected so tests can drive it.

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AuthDeps {
  clientId: unknown;
  storage: KeyValueStore;
  fetch: typeof fetch;
  location: () => PageLocation & { href: string; pathname: string; search: string; hash: string };
  /** Leave the page (to Spotify, or to the 127.0.0.1 twin of this page) */
  navigate: (url: string) => void;
  /** Replace the address bar without reloading, to drop the one-time code from history */
  replaceUrl: (url: string) => void;
  now: () => number;
  random: (a: Uint8Array) => Uint8Array;
}

export type LoginStart =
  /** The browser is on its way to Spotify */
  | { kind: 'redirecting' }
  /** The page is moving to 127.0.0.1; the conductor taps sign in again there */
  | { kind: 'moving_to_loopback'; to: string }
  /** VITE_SPOTIFY_CLIENT_ID is missing or malformed */
  | { kind: 'unconfigured' };

export class SpotifyAuth {
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly deps: AuthDeps) {}

  get configured(): boolean {
    return isClientId(this.deps.clientId);
  }

  async login(): Promise<LoginStart> {
    const clientId = this.deps.clientId;
    if (!isClientId(clientId)) return { kind: 'unconfigured' };
    const loc = this.deps.location();
    if (mustHopOrigin(loc)) {
      const to = `${callbackOrigin(loc)}${loc.pathname}${loc.search}${loc.hash}`;
      this.deps.navigate(to);
      return { kind: 'moving_to_loopback', to };
    }
    const verifier = randomToken(64, this.deps.random);
    const state = randomToken(32, this.deps.random);
    const redirectUri = redirectUriFor(loc);
    const pending: PendingLogin = { verifier, state, redirectUri, createdAt: this.deps.now() };
    this.deps.storage.setItem(PENDING_KEY, JSON.stringify(pending));
    const challenge = await challengeFor(verifier);
    this.deps.navigate(authorizeUrl({ clientId, redirectUri, challenge, state, scopes: SCOPES }));
    return { kind: 'redirecting' };
  }

  /**
   * Finish a login from the callback URL. True when tokens are now stored.
   * The pending login is consumed either way, and the code is removed from
   * the address bar, so a callback can never be replayed.
   */
  async handleCallback(href: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    const pending = parsePending(this.deps.storage.getItem(PENDING_KEY));
    const check = checkCallback(url, pending, this.deps.now());
    if (!check.ok && check.reason === 'not_callback') return false;
    this.deps.storage.removeItem(PENDING_KEY);
    this.deps.replaceUrl('/');
    if (!check.ok || !pending || !isClientId(this.deps.clientId)) return false;
    const tokens = await this.requestTokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: check.code,
        redirect_uri: pending.redirectUri,
        client_id: this.deps.clientId,
        code_verifier: pending.verifier,
      }),
      null,
    );
    if (!tokens) return false;
    this.store(tokens);
    return true;
  }

  /** A valid access token, refreshed when close to expiry; null when signed out or the refresh failed. */
  async getToken(): Promise<string | null> {
    const tokens = this.load();
    if (!tokens) return null;
    if (isFresh(tokens, this.deps.now())) return tokens.accessToken;
    return this.refresh();
  }

  /** Force a refresh (after a 401). Concurrent callers share one request. */
  refresh(): Promise<string | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  isLoggedIn(): boolean {
    return this.load() !== null;
  }

  logout(): void {
    this.deps.storage.removeItem(TOKENS_KEY);
    this.deps.storage.removeItem(PENDING_KEY);
  }

  private async doRefresh(): Promise<string | null> {
    const tokens = this.load();
    if (!tokens?.refreshToken || !isClientId(this.deps.clientId)) {
      this.logout();
      return null;
    }
    const next = await this.requestTokens(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: this.deps.clientId }),
      tokens.refreshToken,
    );
    if (!next) {
      this.logout();
      return null;
    }
    this.store(next);
    return next.accessToken;
  }

  /** POST to the token endpoint. Failures return null; nothing about the request or response is logged. */
  private async requestTokens(body: URLSearchParams, previousRefresh: string | null): Promise<Tokens | null> {
    try {
      const res = await this.deps.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) return null;
      return parseTokenResponse((await res.json()) as unknown, this.deps.now(), previousRefresh);
    } catch {
      return null;
    }
  }

  private load(): Tokens | null {
    return parseStoredTokens(this.deps.storage.getItem(TOKENS_KEY));
  }

  private store(t: Tokens): void {
    this.deps.storage.setItem(TOKENS_KEY, JSON.stringify(t));
  }
}

// The app-wide instance, created on first use so importing this module never touches `window`.

let shared: SpotifyAuth | null = null;

export const spotifyAuth = (): SpotifyAuth => {
  shared ??= new SpotifyAuth({
    clientId: import.meta.env['VITE_SPOTIFY_CLIENT_ID'] as unknown,
    storage: window.sessionStorage,
    fetch: (input, init) => window.fetch(input, init),
    location: () => window.location,
    navigate: (url) => window.location.assign(url),
    replaceUrl: (url) => window.history.replaceState(null, '', url),
    now: () => Date.now(),
    random: (a) => crypto.getRandomValues(a),
  });
  return shared;
};

export const login = (): Promise<LoginStart> => spotifyAuth().login();
export const handleCallback = (url: string): Promise<boolean> => spotifyAuth().handleCallback(url);
export const getToken = (): Promise<string | null> => spotifyAuth().getToken();
export const logout = (): void => spotifyAuth().logout();
export const isLoggedIn = (): boolean => spotifyAuth().isLoggedIn();
