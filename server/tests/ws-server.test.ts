import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { encodeMessage, parseServerMessage, type ServerMessage } from '@kilukkam/shared';
import { startServer, type RunningServer } from '../src/ws-server.js';

let server: RunningServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function connect(port: number): Promise<{ ws: WebSocket; next: () => Promise<ServerMessage> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
    ws.once('open', () => resolve({ ws, next }));
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

    const closed = new Promise<void>((resolve) => player.ws.once('close', () => resolve()));
    cond.ws.close();
    await closed;
  });
});
