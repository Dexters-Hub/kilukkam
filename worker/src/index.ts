import type { Env } from './env.js';
import { openSession } from './session.js';

export { Registry } from './registry.js';
export { Room } from './room.js';

const WS_PATH = '/ws';

/**
 * One policy for every page. connect-src is the allowlist for egress:
 * our own origin and WebSocket, Spotify auth and API for play-along.
 * MediaPipe's telemetry to odml.pa.googleapis.com is deliberately not
 * on it, so the browser blocks it. Keep in sync with web/index.html.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.scdn.co https://mosaic.scdn.co https://*.spotifycdn.com",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' ws: wss: https://accounts.spotify.com https://api.spotify.com",
  "frame-src https://sdk.scdn.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https://accounts.spotify.com",
].join('; ');

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * Browser caching. Vite names its build files by content, so they never
 * change. The hand model, wasm and fonts keep their names; a day's cache with
 * background revalidation spares the 11 MB download on every visit.
 */
function cacheControlFor(pathname: string): string | null {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/mediapipe/') || pathname.startsWith('/fonts/')) return 'public, max-age=86400, stale-while-revalidate=604800';
  return null;
}

function withSecurityHeaders(res: Response, pathname: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  const cache = res.ok ? cacheControlFor(pathname) : null;
  if (cache) out.headers.set('Cache-Control', cache);
  return out;
}

/**
 * Browsers always send Origin on a WS upgrade; refuse cross-site pages
 * (CSWSH). Non-browser clients send none and are allowed.
 */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === WS_PATH) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
      return openSession(env);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
} satisfies ExportedHandler<Env>;
