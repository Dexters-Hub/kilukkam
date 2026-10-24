# Kilukkam architecture

Phones in the same room become instruments. One person conducts;
everyone else taps, and each tap plays the next note of their part:
a 100-phone handbell choir.

## Layout

```
shared/   @kilukkam/shared: protocol types, score format, piece library.
          Pure TS, zero runtime deps, imported by both server and web.
server/   @kilukkam/server: Node ws server. Room registry, lobby state
          machine, message routing, heartbeat. Vitest for unit tests.
web/      @kilukkam/web:    Vite + vanilla TS client. Screens, WS client,
          WebAudio instruments.
docs/     Architecture, protocol contract, decisions.
```

## Model

- **Handbell playback.** The server never streams audio and never
  schedules notes. Every phone renders its own instrument via WebAudio;
  a tap advances that player's cursor one event in their track's event
  list. Latency tolerance is huge because timing is human, not clocked.
- **Server = referee, not clock.** It owns rooms, membership, track
  assignment, and phase transitions (lobby → playing → ended). It also
  broadcasts `note_echo` so the conductor screen (and optionally every
  player) can visualise the ensemble tapping in real time.
- **Room code.** 4 chars from an unambiguous alphabet (no 0/O, 1/I).
  Colliding codes are retried; rooms are in-memory only.
- **Capacity.** `MAX_PLAYERS = 100`. Tracks cap individually
  (`track.maxPlayers`); `auto_assign` picks the least-occupied open
  track so late joiners always land somewhere.
- **Conductor authority.** The first socket to `create_room` is the
  conductor. Only it may `set_piece`, `start_piece`, `stop_piece`,
  `remove_player`. Auto-accept on join (kicking is the moderation tool;
  reviewing 100 joins by hand is not a UX we want).
- **Phases.** `lobby` lets players join/leave/switch tracks freely.
  `playing` freezes track assignment; `note_played` is accepted.
  `stop_piece` returns the room to `ended`, and the conductor may start
  again from `ended` (encore) which resets every cursor to 0.

## Hard boundaries

- All WS payloads are validated with `parseClientMessage` /
  `parseServerMessage` from `@kilukkam/shared`; never trust raw JSON.
- No audio on the server. No state on the client beyond the last
  `room_state` snapshot; the server snapshot is the source of truth.
- Transport is the only infra assumption. `server/` exposes a
  `RoomEngine` pure core (no sockets inside) wrapped by a thin `ws`
  adapter, so a Cloudflare Durable Object can host the same engine
  later without touching game logic.

## Playback UX

- Before `start_piece`, a player sees their track, next note preview,
  and a countdown state. Tapping early does nothing (or plays a dull
  thunk. Product call: ignored, no punishment).
- During `playing`, one giant tap surface per phone: instrument name,
  the current note, the next two upcoming notes. `note_played` is sent
  fire-and-forget; the echoed ripple on other screens is the show.
