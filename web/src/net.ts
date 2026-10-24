import { encodeMessage, parseServerMessage, type ClientMessage, type ServerMessage } from '@kilukkam/shared';
import type { ConnStatus } from './store.js';

// One WebSocket to the room server, same origin as the page (/ws).
// Reconnects with jittered exponential backoff; every inbound frame goes
// through parseServerMessage and anything that fails validation is dropped.

const PING_EVERY_MS = 5000;

export function wsUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

/** Delay before reconnect attempt `attempt` (0-based): base·2^n capped, with ±25% jitter. */
export function backoffDelay(attempt: number, base = 400, max = 8000, rand: () => number = Math.random): number {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(raw * (0.75 + rand() * 0.5));
}

export interface NetHandlers {
  message(msg: ServerMessage): void;
  status(status: ConnStatus): void;
  /** A fresh socket is open; anything room-bound must be (re)sent now. */
  open(): void;
  rtt(ms: number): void;
}

export class Net {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private pinging = false;

  constructor(
    private readonly url: string,
    private readonly h: NetHandlers,
  ) {
    // Phones drop sockets when backgrounded; come back as soon as they're visible.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.kick();
    });
    window.addEventListener('online', () => this.kick());
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.clearRetry();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.h.status(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.h.status('open');
      this.h.open();
      if (this.pinging) this.startPing();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      const msg = parseServerMessage(ev.data);
      if (!msg) return;
      if (msg.type === 'pong') this.h.rtt(Math.max(0, Date.now() - msg.t));
      this.h.message(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.h.status('reconnecting');
      this.retry = setTimeout(() => this.connect(), backoffDelay(this.attempt++));
    };
    // onerror is always followed by onclose; nothing extra to do.
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encodeMessage(msg));
    return true;
  }

  /** Ping only once in a room: the protocol treats pre-join frames as not_in_room. */
  setPinging(on: boolean): void {
    this.pinging = on;
    if (on && this.isOpen) this.startPing();
    if (!on) this.stopPing();
  }

  /** Drop the current socket and start an anonymous one (leave room, after a kick). */
  reset(): void {
    const old = this.ws;
    this.ws = null;
    this.stopPing();
    this.pinging = false;
    this.attempt = 0;
    old?.close(1000, 'reset');
    this.connect();
  }

  /** Reconnect now instead of waiting out the backoff. */
  private kick(): void {
    if (this.ws) return;
    this.attempt = Math.min(this.attempt, 1);
    this.connect();
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.send({ type: 'ping', t: Date.now() });
    ping();
    this.pinger = setInterval(ping, PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
}
