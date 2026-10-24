import {
  CODE_ALPHABET,
  CODE_LEN,
  COUNT_IN_MS,
  MAX_PLAYERS,
  getPiece,
  parseClientMessage,
  validateScore,
  type ClientMessage,
  type DynamicsLevel,
  type ErrorCode,
  type PlayerSnapshot,
  type RoomPhase,
  type RoomSnapshot,
  type Score,
  type ServerMessage,
  type TempoAnchor,
  type Track,
} from '@kilukkam/shared';

/**
 * Socket-free room core. Every input returns the outbound effects as data so
 * any transport (Node `ws`, a Durable Object) can host it unchanged.
 */
export type EngineAction =
  | { kind: 'send'; to: string[]; msg: ServerMessage }
  | { kind: 'close'; socketId: string; reason: string };

export interface EngineOptions {
  now?: () => number;
  /** Uniform [0, 1); drives room code generation */
  random?: () => number;
  newId?: () => string;
}

const CONDUCTOR_NAME = 'Conductor';
const CONDUCTOR_AVATAR = '🎼';
const MAX_CODE_ATTEMPTS = 100;

interface Player {
  id: string;
  socketId: string | null;
  name: string;
  avatar: string;
  trackId: string | null;
  conductor: boolean;
}

interface Room {
  code: string;
  phase: RoomPhase;
  piece: Score;
  startedAt: number | null;
  /** Insertion order = conductor first, then join order */
  players: Map<string, Player>;
  /** Accepted taps per track since the last ensemble_pulse */
  taps: Map<string, number>;
  dynamics: DynamicsLevel;
  mutedTracks: Set<string>;
  customPiece: boolean;
  tempo: TempoAnchor | null;
}

interface Seat {
  room: Room;
  player: Player;
}

type Handler<T extends ClientMessage['type']> = (
  seat: Seat,
  socketId: string,
  msg: Extract<ClientMessage, { type: T }>,
) => EngineAction[];

export class RoomEngine {
  private readonly rooms = new Map<string, Room>();
  private readonly seats = new Map<string, Seat>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;

  constructor(opts: EngineOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  snapshotOf(code: string): RoomSnapshot | undefined {
    const room = this.rooms.get(code.toUpperCase());
    return room && snapshot(room);
  }

  /** Validate a raw text frame, then dispatch it. Never throws. */
  handleFrame(socketId: string, raw: string): EngineAction[] {
    const msg = parseClientMessage(raw);
    if (!msg) return error(socketId, 'bad_message', 'malformed or unknown message');
    return this.handleMessage(socketId, msg);
  }

  handleMessage(socketId: string, msg: ClientMessage): EngineAction[] {
    if (msg.type === 'ping') {
      return [send([socketId], { type: 'pong', t: msg.t, serverTime: this.now() })];
    }
    if (msg.type === 'create_room') return this.createRoom(socketId, msg.pieceId);
    if (msg.type === 'join_room') return this.joinRoom(socketId, msg);

    const seat = this.seats.get(socketId);
    if (!seat) return error(socketId, 'not_in_room', 'join or create a room first');

    switch (msg.type) {
      case 'pick_track':
        return this.pickTrack(seat, socketId, msg);
      case 'auto_assign':
        return this.autoAssign(seat, socketId);
      case 'note_played':
        return this.notePlayed(seat, socketId, msg);
      case 'set_piece':
        return this.asConductor(seat, socketId, msg, this.setPiece);
      case 'start_piece':
        return this.asConductor(seat, socketId, msg, this.startPiece);
      case 'stop_piece':
        return this.asConductor(seat, socketId, msg, this.stopPiece);
      case 'set_tempo':
        return this.asConductor(seat, socketId, msg, this.setTempo);
      case 'assign_track':
        return this.asConductor(seat, socketId, msg, this.assignTrack);
      case 'dj':
        return this.asConductor(seat, socketId, msg, this.djCue);
      case 'set_custom_piece':
        return this.asConductor(seat, socketId, msg, this.setCustomPiece);
      case 'set_dynamics':
        return this.asConductor(seat, socketId, msg, this.setDynamics);
      case 'set_section':
        return this.asConductor(seat, socketId, msg, this.setSection);
      case 'remove_player':
        return this.asConductor(seat, socketId, msg, this.removePlayer);
    }
  }

  handleDisconnect(socketId: string): EngineAction[] {
    const seat = this.seats.get(socketId);
    if (!seat) return [];
    this.seats.delete(socketId);
    const { room, player } = seat;

    if (player.conductor) {
      this.rooms.delete(room.code);
      const others = socketsOf(room).filter((id) => id !== socketId);
      const actions: EngineAction[] = [];
      if (others.length > 0) {
        actions.push(send(others, { type: 'room_closed', reason: 'conductor_left' }));
      }
      for (const id of others) {
        this.seats.delete(id);
        actions.push({ kind: 'close', socketId: id, reason: 'conductor left' });
      }
      return actions;
    }

    // No session resume in v1: a rejoin is a new player, so drop the ghost.
    room.players.delete(player.id);
    return [this.broadcastState(room)];
  }

  /** Called on a fixed cadence (~4 Hz) by the transport; flushes tap counters as ensemble_pulse. */
  tick(now: number): EngineAction[] {
    const actions: EngineAction[] = [];
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing') continue;
      const pulse = this.flushPulse(room, now);
      if (pulse) actions.push(pulse);
    }
    return actions;
  }

  private createRoom(socketId: string, pieceId: string): EngineAction[] {
    if (this.seats.has(socketId)) return error(socketId, 'bad_message', 'already in a room');
    const piece = getPiece(pieceId);
    if (!piece) return error(socketId, 'unknown_piece', `unknown piece: ${pieceId}`);
    const code = this.freshCode();
    if (!code) return error(socketId, 'bad_message', 'no room codes available, try again');

    const conductor: Player = {
      id: this.newId(),
      socketId,
      name: CONDUCTOR_NAME,
      avatar: CONDUCTOR_AVATAR,
      trackId: null,
      conductor: true,
    };
    const room: Room = {
      code,
      phase: 'lobby',
      piece,
      startedAt: null,
      players: new Map([[conductor.id, conductor]]),
      taps: new Map(),
      dynamics: 'mf',
      mutedTracks: new Set(),
      customPiece: false,
      tempo: null,
    };
    this.rooms.set(code, room);
    this.seats.set(socketId, { room, player: conductor });
    return [
      send([socketId], {
        type: 'room_created',
        code,
        playerId: conductor.id,
        snapshot: snapshot(room),
      }),
    ];
  }

  private joinRoom(
    socketId: string,
    msg: Extract<ClientMessage, { type: 'join_room' }>,
  ): EngineAction[] {
    if (this.seats.has(socketId)) return error(socketId, 'bad_message', 'already in a room');
    const room = this.rooms.get(msg.code.trim().toUpperCase());
    if (!room) return error(socketId, 'room_not_found', 'no room with that code');
    const name = msg.name.trim();
    if (!name) return error(socketId, 'invalid_name', 'name is required');
    const avatar = msg.avatar.trim();
    if (!avatar) return error(socketId, 'invalid_avatar', 'avatar is required');
    if (activePlayers(room).length >= MAX_PLAYERS) {
      return error(socketId, 'room_full', 'room is full');
    }

    const player: Player = {
      id: this.newId(),
      socketId,
      name,
      avatar,
      trackId: null,
      conductor: false,
    };
    room.players.set(player.id, player);
    this.seats.set(socketId, { room, player });
    return [
      send([socketId], {
        type: 'joined',
        playerId: player.id,
        snapshot: snapshot(room),
        piece: room.piece,
      }),
      this.broadcastState(room),
    ];
  }

  private pickTrack: Handler<'pick_track'> = ({ room, player }, socketId, msg) => {
    const refused = this.seatChangeRefusal(player, socketId);
    if (refused) return refused;
    const track = room.piece.tracks.find((t) => t.id === msg.trackId);
    if (!track) return error(socketId, 'track_not_found', `no track ${msg.trackId}`);
    if (player.trackId !== track.id && occupancy(room, track.id) >= track.maxPlayers) {
      return error(socketId, 'track_full', `${track.name} is full`);
    }
    player.trackId = track.id;
    return [this.broadcastState(room)];
  };

  private autoAssign({ room, player }: Seat, socketId: string): EngineAction[] {
    const refused = this.seatChangeRefusal(player, socketId);
    if (refused) return refused;
    // Least-occupied by fill ratio so small sections (e.g. a 10-seat cello)
    // fill at the same pace as large ones; ties go to score order.
    let best: { track: Track; fill: number } | undefined;
    for (const track of room.piece.tracks) {
      const taken = occupancy(room, track.id, player.id);
      if (taken >= track.maxPlayers) continue;
      const fill = taken / track.maxPlayers;
      if (!best || fill < best.fill) best = { track, fill };
    }
    if (!best) return error(socketId, 'track_full', 'every track is full');
    player.trackId = best.track.id;
    return [this.broadcastState(room)];
  }

  private notePlayed: Handler<'note_played'> = ({ room, player }, socketId, msg) => {
    if (room.phase !== 'playing') return error(socketId, 'not_started', 'piece is not playing');
    const track = room.piece.tracks.find((t) => t.id === player.trackId);
    if (!track) return error(socketId, 'track_not_found', 'you have no track');
    if (msg.noteIndex >= track.events.length) {
      return error(socketId, 'bad_message', 'noteIndex out of range');
    }
    room.taps.set(track.id, (room.taps.get(track.id) ?? 0) + 1);
    const conductor = conductorOf(room);
    if (!conductor?.socketId) return [];
    return [
      send([conductor.socketId], {
        type: 'note_echo',
        playerId: player.id,
        trackId: track.id,
        noteIndex: msg.noteIndex,
      }),
    ];
  };

  private setPiece: Handler<'set_piece'> = ({ room }, socketId, msg) => {
    if (room.phase === 'playing') return error(socketId, 'already_started', 'stop the piece first');
    const piece = getPiece(msg.pieceId);
    if (!piece) return error(socketId, 'unknown_piece', `unknown piece: ${msg.pieceId}`);
    room.piece = piece;
    room.customPiece = false;
    room.phase = 'lobby';
    room.startedAt = null;
    for (const p of room.players.values()) p.trackId = null;
    return [this.broadcastState(room)];
  };

  private startPiece: Handler<'start_piece'> = ({ room }, socketId, msg) => {
    if (room.phase === 'playing') return error(socketId, 'already_started', 'already playing');
    room.phase = 'playing';
    room.startedAt = this.now() + (msg.countIn ? COUNT_IN_MS : 0);
    room.tempo = null;
    room.taps.clear();
    return [
      send(socketsOf(room), { type: 'piece_started', startedAt: room.startedAt, bpm: room.piece.bpm }),
      this.broadcastState(room),
    ];
  };

  private stopPiece: Handler<'stop_piece'> = ({ room }, socketId) => {
    if (room.phase !== 'playing') return error(socketId, 'not_started', 'piece is not playing');
    // Last taps of the run still count toward everyone's tally.
    const pulse = this.flushPulse(room, this.now());
    room.phase = 'ended';
    return [
      ...(pulse ? [pulse] : []),
      send(socketsOf(room), { type: 'piece_stopped' }),
      this.broadcastState(room),
    ];
  };

  private setCustomPiece: Handler<'set_custom_piece'> = ({ room }, socketId, msg) => {
    if (room.phase === 'playing') {
      return error(socketId, 'already_started', 'stop the piece first');
    }
    const errs = validateScore(msg.score);
    if (errs.length) return error(socketId, 'bad_message', errs.join('; '));
    if (msg.score.tracks.length > 8) return error(socketId, 'bad_message', 'too many tracks (max 8)');
    if (msg.score.title.length > 80) return error(socketId, 'bad_message', 'title too long (max 80)');
    for (const t of msg.score.tracks) {
      if (t.events.length > 2000) {
        return error(socketId, 'bad_message', `track ${t.id} has too many events (max 2000)`);
      }
    }
    room.piece = msg.score;
    room.customPiece = true;
    room.phase = 'lobby';
    room.startedAt = null;
    for (const p of room.players.values()) p.trackId = null;
    return [
      send(socketsOf(room), { type: 'piece_changed', piece: msg.score }),
      this.broadcastState(room),
    ];
  };

  /** Beat index on the room's grid at server time `now` */
  private beatAt(room: Room, now: number): number {
    if (room.tempo) return room.tempo.beat + ((now - room.tempo.at) / 60_000) * room.tempo.bpm;
    if (room.startedAt === null) return 0;
    return Math.max(0, ((now - room.startedAt) / 60_000) * room.piece.bpm);
  }

  private setTempo: Handler<'set_tempo'> = ({ room }, _socketId, msg) => {
    const at = this.now();
    const anchor: TempoAnchor = { bpm: msg.bpm, at, beat: this.beatAt(room, at) };
    room.tempo = anchor;
    return [send(socketsOf(room), { type: 'tempo', ...anchor }), this.broadcastState(room)];
  };

  private assignTrack: Handler<'assign_track'> = ({ room }, socketId, msg) => {
    const target = room.players.get(msg.playerId);
    if (!target || target.conductor) return error(socketId, 'bad_message', 'no such player');
    if (msg.trackId === null) {
      target.trackId = null;
      return [this.broadcastState(room)];
    }
    const track = room.piece.tracks.find((t) => t.id === msg.trackId);
    if (!track) return error(socketId, 'track_not_found', `no track ${msg.trackId}`);
    if (target.trackId !== track.id && occupancy(room, track.id) >= track.maxPlayers) {
      return error(socketId, 'track_full', `${track.name} is full`);
    }
    target.trackId = track.id;
    return [this.broadcastState(room)];
  };

  private djCue: Handler<'dj'> = ({ room }, socketId, msg) => {
    if (room.phase !== 'playing') return error(socketId, 'not_started', 'piece is not playing');
    const out: ServerMessage = msg.bars === undefined
      ? { type: 'dj', cue: msg.cue, at: this.now() }
      : { type: 'dj', cue: msg.cue, at: this.now(), bars: msg.bars };
    return [send(socketsOf(room), out)];
  };

  private setDynamics: Handler<'set_dynamics'> = ({ room }, socketId, msg) => {
    room.dynamics = msg.level;
    return [
      send(socketsOf(room), { type: 'dynamics', level: msg.level }),
      this.broadcastState(room),
    ];
  };

  private setSection: Handler<'set_section'> = ({ room }, socketId, msg) => {
    if (!room.piece.tracks.some((t) => t.id === msg.trackId)) {
      return error(socketId, 'track_not_found', `no track ${msg.trackId}`);
    }
    if (msg.muted) room.mutedTracks.add(msg.trackId);
    else room.mutedTracks.delete(msg.trackId);
    return [this.broadcastState(room)];
  };

  private removePlayer: Handler<'remove_player'> = ({ room }, socketId, msg) => {
    const target = room.players.get(msg.playerId);
    if (!target) return error(socketId, 'bad_message', 'no such player');
    if (target.conductor) return error(socketId, 'bad_message', 'conductor cannot be removed');

    room.players.delete(target.id);
    const actions: EngineAction[] = [this.broadcastState(room)];
    if (target.socketId !== null) {
      this.seats.delete(target.socketId);
      actions.push(
        send([target.socketId], { type: 'room_state', snapshot: snapshot(room) }),
        { kind: 'close', socketId: target.socketId, reason: 'removed by conductor' },
      );
    }
    return actions;
  };

  private asConductor<T extends ClientMessage['type']>(
    seat: Seat,
    socketId: string,
    msg: Extract<ClientMessage, { type: T }>,
    handler: Handler<T>,
  ): EngineAction[] {
    if (!seat.player.conductor) return error(socketId, 'not_conductor', 'conductor only');
    return handler(seat, socketId, msg);
  }

  private seatChangeRefusal(player: Player, socketId: string): EngineAction[] | null {
    // Open in every phase, including playing, so a dropped phone can rejoin mid-piece.
    if (player.conductor) return error(socketId, 'bad_message', 'the conductor does not play a track');
    return null;
  }

  private flushPulse(room: Room, now: number): EngineAction | null {
    if (room.taps.size === 0) return null;
    const counts = Object.fromEntries(room.taps);
    let total = 0;
    for (const n of room.taps.values()) total += n;
    room.taps.clear();
    return send(socketsOf(room), { type: 'ensemble_pulse', counts, total, at: now });
  }

  private broadcastState(room: Room): EngineAction {
    return send(socketsOf(room), { type: 'room_state', snapshot: snapshot(room) });
  }

  private freshCode(): string | null {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) {
        const idx = Math.floor(this.random() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
        code += CODE_ALPHABET[idx];
      }
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }
}

function send(to: string[], msg: ServerMessage): EngineAction {
  return { kind: 'send', to, msg };
}

function error(socketId: string, code: ErrorCode, message: string): EngineAction[] {
  return [send([socketId], { type: 'error', code, message })];
}

function snapshot(room: Room): RoomSnapshot {
  const players: PlayerSnapshot[] = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    trackId: p.trackId,
    connected: p.socketId !== null,
    conductor: p.conductor,
  }));
  return {
    code: room.code,
    phase: room.phase,
    pieceId: room.piece.id,
    players,
    maxPlayers: MAX_PLAYERS,
    startedAt: room.startedAt,
    dynamics: room.dynamics,
    mutedTracks: [...room.mutedTracks],
    customPiece: room.customPiece,
    tempo: room.tempo,
  };
}

/** Connected, non-conductor players: the ones that count toward capacity. */
function activePlayers(room: Room): Player[] {
  return [...room.players.values()].filter((p) => !p.conductor && p.socketId !== null);
}

function occupancy(room: Room, trackId: string, excludeId?: string): number {
  let n = 0;
  for (const p of room.players.values()) {
    if (p.trackId === trackId && p.id !== excludeId) n++;
  }
  return n;
}

function conductorOf(room: Room): Player | undefined {
  for (const p of room.players.values()) if (p.conductor) return p;
  return undefined;
}

function socketsOf(room: Room): string[] {
  const ids: string[] = [];
  for (const p of room.players.values()) if (p.socketId !== null) ids.push(p.socketId);
  return ids;
}
