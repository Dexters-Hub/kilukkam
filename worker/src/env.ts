import type { Registry } from './registry.js';
import type { Room } from './room.js';

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace<Room>;
  REGISTRY: DurableObjectNamespace<Registry>;
}

/** The one Registry instance that hands out room codes */
export function registry(env: Env): DurableObjectStub<Registry> {
  return env.REGISTRY.get(env.REGISTRY.idFromName('global'));
}

export function sendTo(ws: WebSocket | undefined, frame: string): void {
  try {
    ws?.send(frame);
  } catch {
    // Already closing; its close event cleans up.
  }
}

/** Close with a code the runtime accepts; reserved codes (1005, 1006, ...) become 1000. */
export function closeSocket(ws: WebSocket | undefined, code: number, reason: string): void {
  const ok = code >= 1000 && code < 5000 && code !== 1004 && code !== 1005 && code !== 1006 && code !== 1015;
  try {
    ws?.close(ok ? code : 1000, reason.slice(0, 120));
  } catch {
    // Already closed.
  }
}
