# Wire protocol (v1)

Single WebSocket per client. All frames are JSON text, validated by
`parseClientMessage` / `parseServerMessage` in `@kilukkam/shared`.
Unknown or malformed frames MUST be dropped with an `error` message:
never an exception, never a disconnect.

## Client → Server

| type | fields | who | notes |
|---|---|---|---|
| `create_room` | `pieceId` | anyone | first message on a fresh socket |
| `join_room` | `code, name, avatar` | anyone | first message on a fresh socket |
| `pick_track` | `trackId` | player | any phase; fails if track full |
| `auto_assign` | (none) | player | least-occupied open track |
| `set_piece` | `pieceId` | conductor | lobby or ended; from ended returns to lobby and clears track picks |
| `start_piece` | `countIn?` | conductor | lobby or ended → playing; countIn schedules startedAt = now + 3000 ms so every phone starts on one downbeat |
| `stop_piece` | (none) | conductor | playing → ended |
| `remove_player` | `playerId` | conductor | kicks; kicked socket gets `room_state` minus them then close |
| `set_tempo` | `bpm` (40..200) | conductor | any time after start; broadcasts a `tempo` anchor, snapshot carries `tempo` |
| `assign_track` | `playerId, trackId\|null` | conductor | any phase incl. mid-piece; same capacity rules as pick_track |
| `dj` | `cue, bars?` | conductor | playing only; cue = drop \| build \| loop_on \| loop_off; broadcast with server `at` |
| `set_dynamics` | `level` (pp..ff) | conductor | any phase; broadcasts `dynamics` |
| `set_section` | `trackId, muted` | conductor | any phase; snapshot carries `mutedTracks` |
| `note_played` | `noteIndex` | player | playing only; echoes to room |
| `player_tally` | `tally{perfect,great,good,miss,streakBest}` | player | within 1.5 s after piece_stopped; needs a seat |
| `ping` | `t` | anyone | RTT probe |

## Server → Client

| type | fields | notes |
|---|---|---|
| `room_created` | `code, playerId, snapshot` | socket is now the conductor |
| `joined` | `playerId, snapshot, piece` | includes the full Score so the client needs no fetch |
| `room_state` | `snapshot` | broadcast on every membership/phase change |
| `piece_started` | `startedAt, bpm` | server ms (may be in the future with countIn); bpm = piece tempo |
| `tempo` | `bpm, at, beat` | new anchor: beat index `beat` falls at server ms `at`, then `bpm` from there; phones re-anchor without jumps |
| `dj` | `cue, at, bars?` | phones apply locally: drop = silence to next bar, loop = repeat current bar, build = sections fade in by track order |
| `piece_stopped` | (none) | room phase → ended; opens a 1.5 s tally window |
| `piece_results` | `results{sections[], room{notes,accuracy,grade}}` | once, when the window closes; grade S/A/B/C/D at 95/85/70/50 percent |
| `dynamics` | `level` | conductor changed expression; phones scale velocity + show the cue |
| `note_echo` | `playerId, trackId, noteIndex` | conductor only; raw fan-out does not scale to 100 |
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
