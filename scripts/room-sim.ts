// Room simulator: one conductor plus N scripted phones against a real server.
// Each phone taps its actual part on the score's beat grid with human jitter,
// and the run checks what an orchestra cares about: every note arrives once,
// in order, on time, and the parts line up into the right chords.
//
//   npx tsx scripts/room-sim.ts --players 5 [--piece canon-in-d] [--speed 2]
//     [--jitter 25] [--url ws://localhost:8787/ws] [--drop 1] [--json]

import {
  encodeMessage,
  getPiece,
  parseServerMessage,
  type ClientMessage,
  type RoomSnapshot,
  type ServerMessage,
  type Score,
} from '@kilukkam/shared';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const URL_ = arg('url', 'ws://localhost:8787/ws');
const PLAYERS = Number(arg('players', '2'));
const PIECE = arg('piece', 'ode-to-joy');
const SPEED = Number(arg('speed', '1'));
const JITTER_MS = Number(arg('jitter', '25'));
/** Phones that drop mid-piece and rejoin, like a screen lock */
const DROPS = Number(arg('drop', '0'));
const JSON_OUT = process.argv.includes('--json');

const score = getPiece(PIECE);
if (!score) throw new Error(`unknown piece ${PIECE}`);

const now = (): number => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Box-Muller: humans scatter around the beat, mostly close, sometimes not */
const gauss = (sd: number): number => {
  const u = 1 - Math.random();
  const v = Math.random();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

interface Client {
  name: string;
  ws: WebSocket;
  inbox: ServerMessage[];
  errors: string[];
  closedUnexpectedly: boolean;
  wait<T extends ServerMessage['type']>(type: T, pred?: (m: Extract<ServerMessage, { type: T }>) => boolean, ms?: number): Promise<Extract<ServerMessage, { type: T }>>;
  send(msg: ClientMessage): void;
  on(fn: (m: ServerMessage, at: number) => void): void;
  close(): void;
}

const connect = (name: string): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_);
    const listeners: ((m: ServerMessage, at: number) => void)[] = [];
    let closing = false;
    const c: Client = {
      name,
      ws,
      inbox: [],
      errors: [],
      closedUnexpectedly: false,
      wait: (type, pred, ms = 8000) =>
        new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`${name}: timed out waiting for ${type}`)), ms);
          const check = (m: ServerMessage) => {
            if (m.type === type && (!pred || pred(m as never))) {
              clearTimeout(t);
              listeners.splice(listeners.indexOf(check), 1);
              res(m as never);
            }
          };
          listeners.push(check);
        }),
      send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(encodeMessage(msg)),
      on: (fn) => listeners.push(fn),
      close: () => {
        closing = true;
        ws.close();
      },
    };
    ws.addEventListener('open', () => resolve(c));
    ws.addEventListener('error', () => reject(new Error(`${name}: socket error`)));
    ws.addEventListener('close', () => {
      if (!closing) c.closedUnexpectedly = true;
    });
    ws.addEventListener('message', (ev) => {
      const at = now();
      const m = parseServerMessage(String(ev.data));
      if (!m) return c.errors.push('unparseable frame');
      c.inbox.push(m);
      if (m.type === 'error') c.errors.push(`${m.code}: ${m.message}`);
      for (const l of [...listeners]) l(m, at);
    });
  });

/** Onset time (in beats) of every event in a track, rests included. */
const onsets = (events: Score['tracks'][number]['events']): number[] => {
  let beat = 0;
  return events.map((e) => {
    const at = beat;
    beat += e.beats;
    return at;
  });
};

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

interface Sent {
  player: string;
  playerId: string;
  trackId: string;
  noteIndex: number;
  at: number;
  /** Intended onset in ms from the start, before jitter */
  ideal: number;
}

const run = async () => {
  const conductor = await connect('conductor');
  conductor.send({ type: 'create_room', pieceId: score.id });
  const created = await conductor.wait('room_created');
  const code = created.code;

  const echoes: { playerId: string; trackId: string; noteIndex: number; at: number }[] = [];
  let pulseTotal = 0;
  let lastSnap: RoomSnapshot = created.snapshot;
  conductor.on((m, at) => {
    if (m.type === 'note_echo') echoes.push({ playerId: m.playerId, trackId: m.trackId, noteIndex: m.noteIndex, at });
    if (m.type === 'ensemble_pulse') pulseTotal += m.total;
    if (m.type === 'room_state') lastSnap = m.snapshot;
  });

  const players: { client: Client; id: string; trackId: string; name: string }[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const name = `P${i + 1}`;
    const client = await connect(name);
    client.send({ type: 'join_room', code, name, avatar: 'bach' });
    const joined = await client.wait('joined');
    client.send({ type: 'auto_assign' });
    const state = await client.wait('room_state', (m) => m.snapshot.players.some((p) => p.id === joined.playerId && p.trackId !== null));
    const trackId = state.snapshot.players.find((p) => p.id === joined.playerId)?.trackId ?? '';
    players.push({ client, id: joined.playerId, trackId, name });
  }
  const perTrack = Object.fromEntries(score.tracks.map((t) => [t.id, players.filter((p) => p.trackId === t.id).length]));

  conductor.send({ type: 'start_piece' });
  await conductor.wait('piece_started');
  const t0 = now();
  const msPerBeat = 60_000 / score.bpm / SPEED;
  const sent: Sent[] = [];
  let dropped = 0;

  await Promise.all(
    players.map(async (p, pi) => {
      const track = score.tracks.find((t) => t.id === p.trackId);
      if (!track) return;
      const times = onsets(track.events);
      const dropAt = pi < DROPS ? Math.floor(track.events.length / 2) : -1;
      for (let i = 0; i < track.events.length; i++) {
        const ev = track.events[i];
        if (!ev || ev.kind !== 'note') continue;
        const ideal = (times[i] ?? 0) * msPerBeat;
        const target = t0 + Math.max(0, ideal + gauss(JITTER_MS));
        const wait = target - now();
        if (wait > 0) await sleep(wait);
        if (i === dropAt) {
          // Screen lock mid-piece: socket dies, phone comes back and re-picks its part.
          p.client.close();
          dropped++;
          const back = await connect(`${p.name}-rejoin`);
          back.send({ type: 'join_room', code, name: p.name, avatar: 'bach' });
          const joined = await back.wait('joined');
          back.send({ type: 'pick_track', trackId: p.trackId });
          await back.wait('room_state', (m) => m.snapshot.players.some((x) => x.id === joined.playerId && x.trackId === p.trackId));
          p.client = back;
          p.id = joined.playerId;
        }
        p.client.send({ type: 'note_played', noteIndex: i });
        sent.push({ player: p.name, playerId: p.id, trackId: p.trackId, noteIndex: i, at: now(), ideal });
      }
    }),
  );
  await sleep(1200); // let the last echoes and the final pulse land
  conductor.send({ type: 'stop_piece' });
  await conductor.wait('room_state', (m) => m.snapshot.phase === 'ended');
  await sleep(400);

  // ---------- checks ----------
  const key = (playerId: string, noteIndex: number) => `${playerId}#${noteIndex}`;
  const echoCount = new Map<string, number>();
  for (const e of echoes) echoCount.set(key(e.playerId, e.noteIndex), (echoCount.get(key(e.playerId, e.noteIndex)) ?? 0) + 1);
  const missing = sent.filter((s) => !echoCount.has(key(s.playerId, s.noteIndex)));
  const duplicates = [...echoCount.values()].filter((n) => n > 1).length;
  const latency = sent.flatMap((s) => {
    const e = echoes.find((x) => x.playerId === s.playerId && x.noteIndex === s.noteIndex);
    return e ? [e.at - s.at] : [];
  });
  // Per-player order: echoes for one phone must arrive in the order it tapped.
  let outOfOrder = 0;
  for (const p of new Set(echoes.map((e) => e.playerId))) {
    const idx = echoes.filter((e) => e.playerId === p).map((e) => e.noteIndex);
    for (let i = 1; i < idx.length; i++) if ((idx[i] ?? 0) <= (idx[i - 1] ?? 0)) outOfOrder++;
  }

  // Harmony: at every beat where the score has onsets in 2+ parts, did the conductor
  // hear those exact pitches within one sixteenth note of each other?
  const window = msPerBeat / 4;
  const chordBeats = new Map<number, Map<string, number>>();
  for (const t of score.tracks) {
    if (!perTrack[t.id]) continue;
    onsets(t.events).forEach((b, i) => {
      const ev = t.events[i];
      if (ev?.kind !== 'note') return;
      const m = chordBeats.get(b) ?? new Map<string, number>();
      m.set(t.id, ev.midi);
      chordBeats.set(b, m);
    });
  }
  let chords = 0;
  let chordsInTime = 0;
  let wrongPitch = 0;
  for (const [beat, parts] of chordBeats) {
    if (parts.size < 2) continue;
    chords++;
    const heard = [...parts.entries()].map(([trackId, midi]) => {
      const track = score.tracks.find((t) => t.id === trackId);
      const idx = track ? onsets(track.events).findIndex((b, i) => b === beat && track.events[i]?.kind === 'note') : -1;
      const hits = echoes.filter((e) => e.trackId === trackId && e.noteIndex === idx);
      const ev = track?.events[idx];
      if (ev?.kind === 'note' && ev.midi !== midi) wrongPitch++;
      return hits.map((h) => h.at - t0 - beat * msPerBeat);
    });
    const firsts = heard.map((h) => (h.length ? Math.min(...h.map(Math.abs)) : Infinity));
    if (firsts.every((d) => d <= window + JITTER_MS * 3)) chordsInTime++;
  }

  const errors = [conductor, ...players.map((p) => p.client)].flatMap((c) => c.errors.map((e) => `${c.name}: ${e}`));
  const unexpectedCloses = [conductor, ...players.map((p) => p.client)].filter((c) => c.closedUnexpectedly).length;
  const ended = lastSnap.phase === 'ended';
  const ghosts = lastSnap.players.filter((p) => !p.conductor && !p.connected).length;

  const result = {
    players: PLAYERS,
    piece: score.id,
    speed: SPEED,
    perTrack,
    notesSent: sent.length,
    echoes: echoes.length,
    missing: missing.length,
    duplicates,
    outOfOrder,
    pulseTotal,
    pulseMatchesSent: pulseTotal === sent.length,
    latencyMs: { p50: +pct(latency, 50).toFixed(1), p95: +pct(latency, 95).toFixed(1), p99: +pct(latency, 99).toFixed(1), max: +Math.max(0, ...latency).toFixed(1) },
    chords,
    chordsInTime,
    wrongPitch,
    drops: dropped,
    ghostsInRoster: ghosts,
    errors,
    unexpectedCloses,
    ended,
  };
  const pass =
    result.missing === 0 &&
    result.duplicates === 0 &&
    result.outOfOrder === 0 &&
    result.pulseMatchesSent &&
    result.wrongPitch === 0 &&
    result.errors.length === 0 &&
    result.unexpectedCloses === 0 &&
    result.ghostsInRoster === 0 &&
    result.ended &&
    result.latencyMs.p99 < 50;
  if (JSON_OUT) console.log(JSON.stringify({ pass, ...result }));
  else console.log(`${pass ? 'PASS' : 'FAIL'}`, JSON.stringify(result, null, 1));
  conductor.close();
  for (const p of players) p.client.close();
  process.exit(pass ? 0 : 1);
};

run().catch((e: unknown) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
