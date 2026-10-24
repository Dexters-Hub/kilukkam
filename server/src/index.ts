import { WS_PATH, startServer } from './ws-server.js';

const port = Number(process.env.PORT ?? 8787);
// 0.0.0.0 so phones on the same WiFi can reach the LAN IP.
const host = process.env.HOST ?? '0.0.0.0';

const server = await startServer({ port, host });
console.log(`kilukkam ws server listening on ws://${host}:${server.port}${WS_PATH}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
