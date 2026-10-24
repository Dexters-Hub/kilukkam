import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LEN, encodeMessage } from '@kilukkam/shared';
import { RoomEngine, type EngineAction } from './engine.js';
import { closeSocket, registry, sendTo, type Env } from './env.js';

/** ensemble_pulse cadence (~4 Hz), same as the Node server */
const TICK_MS = 250;

interface Attachment {
  socketId: string;
  code: string;
  /** The socket that came to create the room; its close releases the code */
  creator: boolean;
}

/**
 * One room per instance (id = idFromName(code)), hosted by an unchanged
 * RoomEngine. Sockets use the Hibernation API; each one is a relay from the
 * Worker, which already picked this room from the client's first frame.
 */
export class Room extends DurableObject<Env> {
  private code = '';
  private draws = 0;
  /** The engine draws a code from `random`; feed it the one the Registry reserved. */
  private readonly engine = new RoomEngine({ random: () => this.nextCodeDraw() });
  private readonly sockets = new Map<string, WebSocket>();
  /** Between piece_stopped and piece_results the engine still needs ticks */
  private resultsOpen = false;
  private ticking = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Engine state lives in memory only. Sockets that outlived it mean the
    // room is gone: tell the phones and free the code instead of leaving a ghost.
    const orphans = ctx.getWebSockets();
    if (orphans.length > 0) void ctx.blockConcurrencyWhile(() => this.closeOrphans(orphans));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const url = new URL(request.url);
    this.code = url.searchParams.get('code') ?? '';
    const { 0: client, 1: server } = new WebSocketPair();
    const att: Attachment = { socketId: crypto.randomUUID(), code: this.code, creator: url.searchParams.has('create') };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);
    this.sockets.set(att.socketId, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    this.run(this.engine.handleFrame(att.socketId, typeof message === 'string' ? message : ''));
    await this.schedule();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeSocket(ws, code, reason);
    await this.disconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.disconnect(ws);
  }

  override async alarm(): Promise<void> {
    this.ticking = false;
    this.run(this.engine.tick(Date.now()));
    await this.schedule();
  }

  private async disconnect(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    this.sockets.delete(att.socketId);
    this.run(this.engine.handleDisconnect(att.socketId));
    // Conductor left (or never managed to create): the code is free again.
    if (att.creator && this.engine.roomCount === 0) await registry(this.env).release(att.code);
  }

  private run(actions: EngineAction[]): void {
    for (const action of actions) {
      if (action.kind === 'send') {
        if (action.msg.type === 'piece_stopped') this.resultsOpen = true;
        if (action.msg.type === 'piece_results') this.resultsOpen = false;
        const frame = encodeMessage(action.msg);
        for (const id of action.to) sendTo(this.sockets.get(id), frame);
      } else {
        closeSocket(this.sockets.get(action.socketId), 1000, action.reason);
        this.sockets.delete(action.socketId);
      }
    }
  }

  /** Keep a 250 ms alarm going while the room is playing or a results window is open. */
  private async schedule(): Promise<void> {
    if (this.ticking) return;
    const phase = this.engine.snapshotOf(this.code)?.phase;
    if (phase === undefined || (phase !== 'playing' && !this.resultsOpen)) return;
    this.ticking = true;
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private nextCodeDraw(): number {
    const idx = CODE_ALPHABET.indexOf(this.code[this.draws++ % CODE_LEN] ?? '');
    return (Math.max(0, idx) + 0.5) / CODE_ALPHABET.length;
  }

  private async closeOrphans(orphans: WebSocket[]): Promise<void> {
    const frame = encodeMessage({ type: 'room_closed', reason: 'conductor_left' });
    const codes = new Set<string>();
    for (const ws of orphans) {
      codes.add((ws.deserializeAttachment() as Attachment).code);
      sendTo(ws, frame);
      closeSocket(ws, 1000, 'room lost');
    }
    for (const code of codes) await registry(this.env).release(code);
  }
}
