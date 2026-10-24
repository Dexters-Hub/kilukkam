import {
  CODE_ALPHABET,
  CODE_LEN,
  encodeMessage,
  getPiece,
  parseClientMessage,
  parseServerMessage,
} from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from './engine.js';
import { closeSocket, registry, sendTo, type Env } from './env.js';

/** Largest legit frame is a join_room (~150 bytes); anything far bigger is abuse. */
const MAX_FRAME_BYTES = 256 * 1024;
/** Inbound budget per socket: sustained msgs/s, and the burst allowed on top */
const RATE_PER_SEC = 20;
const RATE_BURST = 20;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`);

/**
 * Answers frames from sockets that are not in a room yet (ping, early
 * messages, unknown piece, bad code). It is only ever fed frames that cannot
 * create or join a room, so it stays empty and one instance serves everyone.
 */
const lobby = new RoomEngine();

/** Classic token bucket; `take` is false once the budget is spent. Mirrors server/src/ws-server.ts. */
class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
  ) {
    this.tokens = capacity;
  }

  take(): boolean {
    const t = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Accept a phone's socket at the edge; its first create_room or join_room picks the Room DO. */
export function openSession(env: Env): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  new Session(server, env);
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * One phone. Until it is seated, frames are routed here; after that they
 * relay verbatim to its Room DO, which runs the engine.
 */
class Session {
  private readonly id = crypto.randomUUID();
  private readonly bucket = new TokenBucket(RATE_BURST, RATE_PER_SEC);
  private upstream: WebSocket | null = null;
  private seated = false;
  private closed = false;
  /** Frames are handled strictly in order, even across the awaits of joining a room */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ws: WebSocket,
    private readonly env: Env,
  ) {
    ws.addEventListener('message', (ev) => this.onFrame(ev.data));
    ws.addEventListener('close', () => this.shutdown());
    ws.addEventListener('error', () => this.shutdown());
  }

  private onFrame(data: string | ArrayBuffer): void {
    if (this.closed || !this.bucket.take()) return; // over budget: drop silently
    if (byteSize(data) > MAX_FRAME_BYTES) {
      closeSocket(this.ws, 1009, 'frame too large');
      this.shutdown();
      return;
    }
    const raw = typeof data === 'string' ? data : '';
    this.queue = this.queue
      .then(() => this.route(raw))
      .catch(() => {
        closeSocket(this.ws, 1011, 'room unavailable');
        this.shutdown();
      });
  }

  private async route(raw: string): Promise<void> {
    if (this.closed) return;
    if (this.seated) {
      sendTo(this.upstream ?? undefined, raw);
      return;
    }
    const msg = parseClientMessage(raw);
    if (msg?.type === 'create_room' && getPiece(msg.pieceId)) {
      const code = await registry(this.env).reserve();
      if (code) return this.enter(code, raw, true);
      this.deliver([{ kind: 'send', to: [this.id], msg: { type: 'error', code: 'bad_message', message: 'no room codes available, try again' } }]);
      return;
    }
    if (msg?.type === 'join_room') {
      const code = msg.code.trim().toUpperCase();
      if (CODE_RE.test(code)) return this.enter(code, raw, false);
    }
    this.deliver(lobby.handleFrame(this.id, raw));
  }

  /** Relay `raw` to the room's DO; stay there if it seats us, else drop back to the lobby. */
  private async enter(code: string, raw: string, create: boolean): Promise<void> {
    const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
    const res = await stub.fetch(`https://room/connect?code=${code}${create ? '&create=1' : ''}`, {
      headers: { Upgrade: 'websocket' },
    });
    const up = res.webSocket;
    if (!up) throw new Error(`room ${code} refused the socket`);
    up.accept();
    if (this.closed) {
      closeSocket(up, 1000, 'client left');
      return;
    }

    let answered = false;
    let settle: (seated: boolean) => void = () => {};
    const seated = new Promise<boolean>((resolve) => (settle = resolve));
    up.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      sendTo(this.ws, ev.data);
      if (answered) return;
      const reply = parseServerMessage(ev.data);
      if (!reply) return;
      answered = true;
      settle(reply.type === 'room_created' || reply.type === 'joined');
    });
    up.addEventListener('close', (ev) => {
      settle(false);
      if (this.upstream !== up) return;
      this.upstream = null;
      closeSocket(this.ws, ev.code, ev.reason);
      this.shutdown();
    });

    this.upstream = up;
    up.send(raw);
    if (await seated) {
      this.seated = true;
      return;
    }
    // Refused (room_not_found, room_full, ...): the error already went out; stay anonymous.
    if (this.upstream === up) this.upstream = null;
    closeSocket(up, 1000, 'not seated');
  }

  private deliver(actions: EngineAction[]): void {
    for (const action of actions) {
      if (action.kind === 'send') sendTo(this.ws, encodeMessage(action.msg));
      else closeSocket(this.ws, 1000, action.reason);
    }
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    const up = this.upstream;
    this.upstream = null;
    closeSocket(up ?? undefined, 1000, 'client left');
  }
}

function byteSize(data: string | ArrayBuffer): number {
  if (typeof data !== 'string') return data.byteLength;
  // UTF-8 is at most 3 bytes per UTF-16 unit; only measure exactly when it could matter.
  return data.length * 3 <= MAX_FRAME_BYTES ? data.length : new TextEncoder().encode(data).byteLength;
}
