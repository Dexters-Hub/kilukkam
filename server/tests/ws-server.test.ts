import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { encodeMessage, parseServerMessage, type ServerMessage } from '@kilukkam/shared';
import { TokenBucket, startServer, type RunningServer } from '../src/ws-server.js';

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function connect(
  port: number,
  origin?: string,
): Promise<{ ws: WebSocket; next: () => Promise<ServerMessage>; queue: ServerMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on('message', (data) => {
    const msg = parseServerMessage(String(data));
    if (!msg) throw new Error(`server sent invalid frame: ${String(data)}`);
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  const next = () =>
    new Promise<ServerMessage>((resolve) => {
      const m = queue.shift();
      if (m) resolve(m);
      else waiters.push(resolve);
    });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, next, queue }));
    ws.once('error', reject);
  });
}

describe('ws adapter', () => {
  it('answers malformed frames with bad_message and keeps the socket open', async () => {
    server = await startServer({ port: 0 });
    const { ws, next } = await connect(server.port);

    ws.send('{not json');
    expect(await next()).toMatchObject({ type: 'error', code: 'bad_message' });

    ws.send(encodeMessage({ type: 'ping', t: 7 }));
    expect(await next()).toMatchObject({ type: 'pong', t: 7 });
    ws.close();
  });

  it('closes player sockets when the conductor disconnects', async () => {
    server = await startServer({ port: 0 });
    const cond = await connect(server.port);
    cond.ws.send(encodeMessage({ type: 'create_room', pieceId: 'ode-to-joy' }));
    const created = await cond.next();
    if (created.type !== 'room_created') throw new Error('expected room_created');

    const player = await connect(server.port);
    player.ws.send(encodeMessage({ type: 'join_room', code: created.code, name: 'A', avatar: '🎻' }));
    expect((await player.next()).type).toBe('joined');

    expect((await player.next()).type).toBe('room_state');

    const closed = new Promise<void>((resolve) => player.ws.once('close', () => resolve()));
    cond.ws.close();
    expect(await player.next()).toEqual({ type: 'room_closed', reason: 'conductor_left' });
    await closed;
  });

  it('drops frames beyond the per-socket rate limit without closing', async () => {
    server = await startServer({ port: 0 });
    const { ws, queue } = await connect(server.port);
    for (let i = 0; i < 60; i++) ws.send(encodeMessage({ type: 'ping', t: i }));
    await new Promise((r) => setTimeout(r, 150));
    const pongs = queue.filter((m) => m.type === 'pong').length;
    expect(pongs).toBeGreaterThanOrEqual(15);
    expect(pongs).toBeLessThanOrEqual(25);
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('accepts a same-origin upgrade', async () => {
    server = await startServer({ port: 0 });
    const { ws, next } = await connect(server.port, `http://127.0.0.1:${server.port}`);
    ws.send(encodeMessage({ type: 'ping', t: 1 }));
    expect(await next()).toMatchObject({ type: 'pong', t: 1 });
    ws.close();
  });

  it('rejects an upgrade from a foreign Origin', async () => {
    server = await startServer({ port: 0 });
    await expect(connect(server.port, 'http://evil.example')).rejects.toThrow(/403/);
  });
});

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    let t = 0;
    const bucket = new TokenBucket(20, 20, () => t);
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (bucket.take()) allowed++;
    expect(allowed).toBe(20);
    t = 500;
    allowed = 0;
    for (let i = 0; i < 30; i++) if (bucket.take()) allowed++;
    expect(allowed).toBe(10);
  });
});
