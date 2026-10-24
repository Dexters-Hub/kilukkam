// Shared clock: every phone estimates its offset from the server's clock so
// the whole room agrees on "now" to within a few milliseconds. NTP-style: a
// ping carries our send time, the pong carries the server's time, and the
// sample with the lowest round trip is the most trustworthy.

export interface ClockSample {
  /** Local ms when the ping left */
  sent: number;
  /** Server ms stamped on the pong */
  server: number;
  /** Local ms when the pong arrived */
  received: number;
}

/** Offset (server minus local) and round-trip time of one ping. */
export const measure = ({ sent, server, received }: ClockSample): { offset: number; rtt: number } => ({
  offset: server - (sent + received) / 2,
  rtt: Math.max(0, received - sent),
});

/** Best estimate from recent samples: average the offsets of the fastest third. */
export const estimate = (samples: readonly ClockSample[]): { offset: number; rtt: number } | null => {
  if (samples.length === 0) return null;
  const measured = samples.map(measure).sort((a, b) => a.rtt - b.rtt);
  const best = measured.slice(0, Math.max(1, Math.ceil(measured.length / 3)));
  const offset = best.reduce((sum, m) => sum + m.offset, 0) / best.length;
  return { offset, rtt: best[0]?.rtt ?? 0 };
};

const KEEP = 12;

export class ServerClock {
  private samples: ClockSample[] = [];
  private offset = 0;
  private rttMs = 0;
  private synced = false;

  constructor(private readonly local: () => number = () => Date.now()) {}

  /** Feed one ping/pong round trip. */
  add(sent: number, server: number, received = this.local()): void {
    this.samples.push({ sent, server, received });
    if (this.samples.length > KEEP) this.samples.shift();
    const e = estimate(this.samples);
    if (!e) return;
    this.offset = e.offset;
    this.rttMs = e.rtt;
    this.synced = true;
  }

  /** Server time right now, in ms. */
  now(): number {
    return this.local() + this.offset;
  }

  /** Local ms at which the server clock reads `serverMs`. */
  toLocal(serverMs: number): number {
    return serverMs - this.offset;
  }

  get rtt(): number {
    return this.rttMs;
  }

  get ready(): boolean {
    return this.synced;
  }
}
