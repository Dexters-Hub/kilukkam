import type { Env } from './env.js';
import { openSession } from './session.js';

export { Registry } from './registry.js';
export { Room } from './room.js';

const WS_PATH = '/ws';

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
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
