# Wire protocol (v1)

Single WebSocket per client. All frames are JSON text, validated by
`parseClientMessage` / `parseServerMessage` in `@kilukkam/shared`.
Unknown or malformed frames MUST be dropped with an `error` message —
never an exception, never a disconnect.

## Client → Server

| type | fields | who | notes |
|---|---|---|---|
| `create_room` | `pieceId` | anyone | first message on a fresh socket |
| `join_room` | `code, name, avatar` | anyone | first message on a fresh socket |
| `pick_track` | `trackId` | player | any phase; fails if track full |
| `auto_assign` | — | player | least-occupied open track |
| `set_piece` | `pieceId` | conductor | lobby or ended; from ended returns to lobby and clears track picks |
| `start_piece` | — | conductor | lobby or ended → playing |
| `stop_piece` | — | conductor | playing → ended |
| `remove_player` | `playerId` | conductor | kicks; kicked socket gets `room_state` minus them then close |
| `note_played` | `noteIndex` | player | playing only; echoes to room |
| `ping` | `t` | anyone | RTT probe |

## Server → Client

| type | fields | notes |
|---|---|---|
| `room_created` | `code, playerId, snapshot` | socket is now the conductor |
| `joined` | `playerId, snapshot, piece` | includes the full Score so the client needs no fetch |
| `room_state` | `snapshot` | broadcast on every membership/phase change |
| `piece_started` | `startedAt` | server ms timestamp |
| `piece_stopped` | — | room phase → ended |
| `note_echo` | `playerId, trackId, noteIndex` | conductor only — raw fan-out does not scale to 100 |
| `ensemble_pulse` | `counts{trackId:n}, total, at` | ~4 Hz during playing, to everyone; feeds ambient room visuals |
| `room_closed` | `reason` | sent before sockets close (conductor left) |
| `pong` | `t, serverTime` | |
| `error` | `code, message` | `ErrorCode` union in protocol.ts |

## Rules

- A socket is anonymous until `create_room` or `join_room`; every other
  message before that is `error:not_in_room`.
- `name` ≤ 20 chars, `avatar` ≤ 24 chars (composer id or emoji), `code` case-insensitive.
- Disconnects remove the player from the roster entirely and rebroadcast
  `room_state`; rejoins are new players (no session resume in v1). Track
  picks are allowed during `playing` so a dropped phone can rejoin
  mid-piece. Conductor disconnect closes the room immediately after a
  `room_closed` message to every player.
- Inbound rate limit: ~20 msgs/s per socket; excess frames are dropped.
- `note_played` carries the player's own cursor index; the server does
  not validate musicality, only bounds (`0 <= i < events.length`).
