# Changelog

All notable changes, newest first. Times are IST (UTC+05:30). Entries
before the docs commit are backfilled from `git log`.

## Unreleased

- 2026-10-25 02:44: Ship the camera model with every deploy. `npm run
  build` now runs `scripts/fetch-mediapipe.sh` first (wasm copied from the
  installed package, model downloaded, both hash checked), so the live
  camera pages stop reporting that hand tracking cannot run. The seating
  chart rows get labelled Move and Remove pills, the Spotify tab explains
  itself when no Client ID is configured, and DEPLOY.md documents both.

- 2026-10-25 02:30: Guitar, more songs, and a player you can see. A
  plucked-string fingerstyle guitar is the sixth instrument (home tabs,
  play-along, MIDI export as nylon guitar). Four new public-domain pieces
  with guitar parts: Romance, Greensleeves, In the Hall of the Mountain
  King (with drums) and Für Elise, and a guitar part for Ode to Joy.
  Spotify play-along shows a now-playing card (art, progress, status,
  whether it landed on the beat), searches songs, adds a fingerstyle
  guitar part when the key is set, and says plainly when a browser lacks
  Widevine. Live camera conducting is verified end to end against the
  room (tempo, dynamics, cues, cut-off). Thumb-to-fingertip finger play,
  left and right hands told apart by position, a Host a room call to
  action, drum hit names (Kick, Snare), and the logo in Inter with RIT
  Kutty for the Malayalam.

- 2026-10-25 02:00: Play that is harder and clearer. Two hands on the
  phone: notes come down a left or right lane (thumbs, or F and J), a
  wrong side breaks the combo. Drums are a fifth instrument with a
  synthesised kit, played in Boss Rush, Pixel Plains and Spotify
  play-alongs. Camera conducting scores by targets (closest approach and
  arrival time) after a calibration circle and a count-in, with 2/4, 3/4
  and 4/4 patterns, levels, always-visible section zones (point and hold
  to cue), the left hand for cues and dynamics, and springy grade pops,
  particles, combo and streak cheers. Song search on Spotify. The home
  hero is a product shot of the laptop and phones that you can play. The
  pitch deck is updated with camera and drums slides.

- 2026-10-25 01:30: Brand and flow revamp. Neon lime on paper and ink,
  one vivid colour per instrument, Nupuram ExtraBold wordmark (OFL), new
  rattle icon, favicon, app icons and share image, and a light/dark
  switch (light by default). Home is a playable orchestra of phones
  around a conductor with live screen previews and a camera section.
  Pick a piece is a music shelf with animated covers and 12 second
  previews. The conductor room has a live seating chart; players get an
  instrument straight away with swap chips and a tap warm-up. Results
  show a grade, timing breakdown and a shareable result card. Pieces now
  end on their own when the music runs out. Camera conducting on the
  live stage drives tempo, dynamics, section cues and the cut-off.
  Keyboard play (space, F, J, D, K) on laptops; share and copy for the
  join link. The play screen pulses on every beat with glowing note
  gems, hit bursts and a rest countdown.

- 2026-10-24 23:55: Spotify play-along flow. Playlists open into their
  songs, a pasted song or playlist link opens too, and picking a song
  leads to a tap-the-beat setup (meter 3 or 4, optional key). "Open the
  room" sends a play-along score titled with the song. On start the
  conductor laptop plays the song so a song beat lands on the room's
  beat 0, then seeks once if it is more than 40 ms off; it pauses on
  stop. Pure sync maths in `web/src/lib/spotify/sync.ts` with tests.
- Docs: launch README, hackathon docs (`RULES.md`, `AGENTS.md`,
  `AI_USAGE.md`, `CHANGELOG.md`, `SUBMISSION.md`) and a PR template.

## 2026-10-24 21:51 · `764aedf`

**Add custom-piece upload, conductor dynamics, no-em-dash sweep**

- Protocol: `set_custom_piece {score}` (conductor only, not while
  playing), `piece_changed` broadcast, `customPiece` flag on
  `RoomSnapshot`.
- `ws` frame limit raised to 256KB for score payloads.
- Engine validates custom scores and caps them at 8 tracks, 2000 events
  per track and an 80-character title.
- Em and en dashes removed repo-wide per owner rule.

## 2026-10-24 21:23 · `d79e619`

**Add conductor expression and section mute**

- Protocol v1 gains `set_dynamics` (pp to ff) and
  `set_section {trackId, muted}`, plus a `dynamics` broadcast.
- `dynamics` and `mutedTracks` added to `RoomSnapshot` so late joiners
  see the current state.
- Engine enforces conductor-only control and validates track ids.

## 2026-10-24 21:15 · `f8a8f16`

**Add web client and scale hardening**

- Vite + vanilla TS client: composer-avatar roster, Space Grotesk and
  Inter with the Malayalam wordmark, first-run explainer, haptics,
  ambient room dots, GSAP motion.
- Scale hardening for 100 players: disconnected players leave the
  roster, `note_echo` is conductor-only with a 4 Hz `ensemble_pulse` to
  everyone, `room_closed` on conductor exit, per-socket rate limiting and
  a same-host origin check.
- Instrument picks allowed mid-piece so dropped phones can rejoin.
- Verified end to end: create, join, pick, start, tap, stage counter,
  stop, recap.

## 2026-10-24 20:55 · `f91f319`

**Add room engine and ws adapter**

- Socket-free `RoomEngine`: rooms, 4-character codes, track assignment,
  conductor-only phase control, `note_echo` broadcast; 36 unit tests.
- Thin `ws` adapter on `:8787/ws`.
- Avatar field widened to 24 characters for composer ids.

## 2026-10-24 20:01 · `96f9b39`

**Scaffold monorepo and freeze shared contracts**

- npm workspaces: `shared`, `server`, `web`.
- Protocol v1, score format, Canon in D and Ode to Joy.

## 2026-10-24 19:14 · `3e6a5f9`

**First commit**
