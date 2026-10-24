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
| `stop_piece` | (none) | conductor | playing → ended; the only way a piece ends early (no camera gesture sends it) |
| `pause_piece` | (none) | conductor | playing, not paused; freezes the room grid on the current beat; snapshot carries `paused{at,beat,bpm}` |
| `resume_piece` | (none) | conductor | paused only; plays on from the paused beat after a count-in of `RESUME_COUNT_IN_BEATS` (2) beats |
| `kilukkam` | (none) | conductor | playing only; the room-wide bell; rate limited to one per `KILUKKAM_COOLDOWN_MS` (3000) per room, extra rings are dropped silently |
| `remove_player` | `playerId` | conductor | kicks; kicked socket gets `room_state` minus them then close |
| `set_tempo` | `bpm` (40..200) | conductor | any time after start; broadcasts a `tempo` anchor, snapshot carries `tempo`; while paused it only sets `paused.bpm` for the resume (no anchor, the grid stays frozen) |
| `assign_track` | `playerId, trackId\|null` | conductor | any phase incl. mid-piece; same capacity rules as pick_track |
| `dj` | `cue, bars?` | conductor | playing and not paused; cue = drop \| build \| loop_on \| loop_off; broadcast with server `at` |
| `set_dynamics` | `level` (pp..ff) | conductor | any phase; broadcasts `dynamics` |
| `set_section` | `trackId, muted` | conductor | any phase; snapshot carries `mutedTracks` |
| `note_played` | `noteIndex` | player | playing and not paused; echoes to room |
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
| `piece_paused` | `at, beat` | the room grid stands still on `beat` from server ms `at`; phones freeze their lanes, stay silent, score nothing |
| `piece_resumed` | `at, beat, bpm` | beat `beat` falls on server ms `at` (now plus the count-in), then `bpm`; phones show the count back in |
| `kilukkam` | `at` | every phone (and the stage) flashes, sparkles and rings its bell together |
| `piece_stopped` | (none) | room phase → ended; opens a 1.5 s tally window |
| `piece_results` | `results{sections[], room{notes,accuracy,grade}}` | once, when the window closes; grade S/A/B/C/D at 95/85/70/50 percent |
| `dynamics` | `level` | conductor changed expression; phones scale velocity + show the cue |
| `note_echo` | `playerId, trackId, noteIndex` | conductor only; raw fan-out does not scale to 100 |
| `ensemble_pulse` | `counts{trackId:n}, total, at` | ~4 Hz during playing, to everyone; feeds ambient room visuals |
| `room_closed` | `reason` | sent before sockets close (conductor left) |
| `pong` | `t, serverTime` | |
| `error` | `code, message` | `ErrorCode` union in protocol.ts |

## Rules

- Server beat maths matches the phones' `BeatGrid`: negative during a
  count-in, frozen while `paused` is set. A tempo anchor made during the
  start count-in keeps the count-in.

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

## Room games (v1 contract; engine lands separately)

See `docs/specs/room-games.md`. Reuses rooms, codes and seating.

| dir | type | fields | notes |
|---|---|---|---|
| C→S | `start_game` | `mode, seed?, level?` | conductor, lobby or ended; mode = thaalam, echo, tempo; seed defaults to today |
| C→S | `game_tap` | `midi?` or `bpm?` | player; thaalam/echo send the midi they hold, tempo sends a bpm |
| C→S | `game_hint` | `kind` | conductor; replay, era, first_interval; each spends a try |
| C→S | `game_answer` | `song` | optional bonus after solving; right doubles the score |
| C→S | `end_game` | (none) | conductor; back to lobby |
| S→C | `game_state` | `game` | full state on every change; the engine judges, phones render |
| S→C | `game_row` | `row{guess,tiles}, playback[{midi,playerIds}]` | after each submitted guess; each phone in playback sounds its note in order |
| S→C | `game_result` | `score, solved, grid, bonusAvailable` | grid is the spoiler-free emoji share card |
| S→C | `game_ended` | (none) | |

Tiles: green = right note right slot; amber = in the phrase, wrong slot;
teal = octave, 4th or 5th of the right note (pitchd partial credit);
grey = not in the phrase. `GAME_TRIES = 6`.

## Camera conductor gestures (stage only, no wire format of their own)

The stage's camera turns gestures into the conductor messages above. No
gesture sends `stop_piece`. Detectors live in
`web/src/lib/camera/conductor.ts`; the mapping in
`web/src/features/stage/gestureActions.ts`.

| gesture | gate | sends |
|---|---|---|
| Beat time with the baton hand | steady gaps, at most once a bar | `set_tempo` |
| Off-hand flat, lifted or pressed | 1.2 hand sizes inside 1.5 s | `set_dynamics` one step up or down |
| Point into a third | held 1 s | `set_section muted:false` for that third |
| One stop hand in a third | held 1 s | `set_section muted:true` for that third |
| Both stop hands | held 0.8 s | `pause_piece` |
| One big downbeat, while paused | beat size 0.55 or more | `resume_piece` |
| Both palms up, rising slowly | 1.5 hand sizes over 0.9 s or more | `dj build` |
| Both hands sweep down fast | then 300 ms down | `dj drop` |
| Circle with the index finger | 300 degrees inside 1.2 s | `dj loop_on` or `loop_off` |
| Shake like a bell | 3 reversals inside 0.8 s | `kilukkam` |

Nothing counts in the first 3 s after the camera starts, or from a hand in
view for under 500 ms.

