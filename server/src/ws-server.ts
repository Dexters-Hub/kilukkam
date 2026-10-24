import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { encodeMessage } from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from './room-engine.js';

export const WS_PATH = '/ws';
/** Largest legit frame is a join_room (~150 bytes); anything far bigger is abuse. */
const MAX_FRAME_BYTES = 256 * 1024;
const HEARTBEAT_MS = 30_000;
/** ensemble_pulse cadence (~4 Hz) */
const TICK_MS = 250;
/** Inbound budget per socket: sustained msgs/s, and the burst allowed on top */
const RATE_PER_SEC = 20;
const RATE_BURST = 20;

/** Classic token bucket; `take` is false once the budget is spent. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Browsers always send Origin on a WS upgrade; refuse cross-site pages
 * (CSWSH). Non-browser clients send none and are allowed.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export interface ServerOptions {
  port: number;
  host?: string;
  engine?: RoomEngine;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/** Thin `ws` adapter: sockets in, engine actions out. No game logic here. */
export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const engine = opts.engine ?? new RoomEngine();
  const sockets = new Map<string, WebSocket>();
  const alive = new WeakSet<WebSocket>();
  const wss = new WebSocketServer({
    port: opts.port,
    ...(opts.host ? { host: opts.host } : {}),
    path: WS_PATH,
    maxPayload: MAX_FRAME_BYTES,
    verifyClient: (info, done) => done(sameOrigin(info.req), 403, 'Forbidden'),
  });

  const run = (actions: EngineAction[]): void => {
    for (const action of actions) {
      if (action.kind === 'send') {
        const frame = encodeMessage(action.msg);
        for (const id of action.to) {
          const ws = sockets.get(id);
          if (ws && ws.readyState === ws.OPEN) ws.send(frame);
        }
      } else {
        sockets.get(action.socketId)?.close(1000, action.reason);
      }
    }
  };

  wss.on('connection', (ws) => {
    const socketId = randomUUID();
    sockets.set(socketId, ws);
    alive.add(ws);
    const bucket = new TokenBucket(RATE_BURST, RATE_PER_SEC);

    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, isBinary) => {
      if (!bucket.take()) return; // over budget: drop silently
      const raw = isBinary ? '' : String(data);
      run(engine.handleFrame(socketId, raw));
    });
    ws.on('close', () => {
      sockets.delete(socketId);
      run(engine.handleDisconnect(socketId));
    });
    // Oversized frames and protocol errors land here; `close` follows.
    ws.on('error', () => ws.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const ticker = setInterval(() => run(engine.tick(Date.now())), TICK_MS);
  ticker.unref();

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      const port = addr !== null && typeof addr === 'object' ? addr.port : opts.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            clearInterval(ticker);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
