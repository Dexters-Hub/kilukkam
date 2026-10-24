import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { encodeMessage } from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from './room-engine.js';

export const WS_PATH = '/ws';
/** Largest legit frame is a join_room (~150 bytes); anything far bigger is abuse. */
const MAX_FRAME_BYTES = 4 * 1024;
const HEARTBEAT_MS = 30_000;

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

    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, isBinary) => {
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
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
