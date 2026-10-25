# Changelog

All notable changes, newest first. Times are IST (UTC+05:30). Entries
before the docs commit are backfilled from `git log`.

## Unreleased

- 2026-10-25 06:00: Leaderboard scores are out of 1000 and fair across
  parts: 900 for timing as a share of your own notes, 100 for your longest
  streak, so a flawless short part beats a sloppy long one. The crown sits
  on the winner's portrait.

- 2026-10-25 05:58: A room leaderboard ends every piece. Each phone
  reports its run once when the piece stops (by hand or at the end of the
  music), the server keeps one tally per player, bounds it by the player's
  part and ranks everyone by score (3 per perfect, 2 per great, 1 per good,
  plus a point per 10-note streak). The big screen shows a podium for the
  top three with a crown and "Best musician" for first place, then everyone
  else ranked; each phone shows "You placed #N of M" and the top three.
  "Counting the scores…" covers the short wait.

- 2026-10-25 05:24: The camera starts faster. The conductor's lobby and
  stage fetch hand tracking (about 11 MB) in the background while the room
  fills, the Worker lets browsers keep the build files for good and the
  model, wasm and fonts for a day, and the button says "Loading hand
  tracking…" while the graphics engine warms up.

- 2026-10-25 05:12: Camera practice levels end. Clearing level 8 stops
  the guide and shows "All 8 levels cleared!" with your best streak and
  accuracy, plus a Play again button that starts from level 1.

- 2026-10-25 04:58: The camera page puts Start camera beside its
  heading, keeps the header bar solid so headings never show through on
  scroll, and shows the help button as an icon on phones so the theme
  switch fits.

- 2026-10-25 04:56: Icons are clean lines: the faint duotone tint that
  read as a grey box behind the tick, the X and others is gone, and the
  camera and Host a room icon tiles are lime tinted instead of grey.

- 2026-10-25 04:54: The tap line sits low, as in Piano Tiles (about 87%
  down the screen), where thumbs rest. The next note moves to the top,
  the first-run hint is a small pill under it, and the room's other
  players are one row along the bottom.

- 2026-10-25 04:40: The camera conductor controls the room live and can
  no longer end it. Root cause of the "Well played" bug: a held fist was a
  cut-off that sent `stop_piece`, and its 3 s grace counted from the piece
  start, not the camera start, so a hand raised into view mid-piece ended
  the run. The fist gesture is gone. The owner-approved set: beat time
  (tempo), the off-hand palm lifted or pressed (one dynamics step), point
  and hold (section in), one stop hand in a third (section rests), both
  stop hands (pause), one big downbeat (resume after a 2 beat count-in),
  both palms rising (build), both hands down fast (drop), a circle with the
  finger (loop bar) and a bell shake (Kilukkam!). Each has a gate and a
  fill-up ring; nothing counts in the first 3 s or from a hand in view
  under 500 ms. New `pause_piece`, `resume_piece` and `kilukkam` messages,
  `piece_paused`, `piece_resumed` and `kilukkam` events and a `paused`
  snapshot field (the worker shares the engine). Phones show a tempo chip
  ("Slower · 92 bpm"), "Cello rests", "Paused by the conductor", the count
  back in, and flash, sparkle and ring together on Kilukkam. With the
  camera on, the stage shows live readouts and folds the buttons into "No
  camera? Use buttons". `?camdemo` performs all ten. Only Stop ends a piece.

- 2026-10-25 04:36: The wordmark lines up with the logo. "Kilukkam" and
  കിലുക്കം share one baseline and sit centred on the mark; RIT Ala hangs its
  vowel signs low, so the words are nudged down to match.

- 2026-10-25 04:25: The Malayalam name in the logo is now set in RIT Ala
  (Rachana Institute of Typography, OFL), a clean rounded line, in the
  header, the camera page and the share card. RIT Kutty is removed.

- 2026-10-25 04:10: The Spotify play-along tab is locked as "Coming soon"
  until sign-in and playback are solid on every device. The code stays;
  one flag in the music picker turns it back on.

- 2026-10-25 03:34: Play mode is now Piano Tiles with glass tiles.
  A Level picker (Easy, Normal, Hard, Expert) sets 1, 2 or 4 columns;
  Expert adds hold tiles that fill while held and arrow tiles you swipe
  up. Tiles are translucent glass in the instrument colour; hits spark
  and throw a beam up the column, misses flash red, and disco lights
  pulse brighter with the combo. Reduced motion keeps gentle flashes
  only. Replaces the two-hands setting.

- 2026-10-25 03:30: Camera practice levels advance again. Picking a
  tempo or pattern no longer switches Levels off, and moving up now reads
  your last 8 beats (6 good, average 65 or more) instead of 8 perfect
  beats in a row. The level line shows "N of 6 good beats".

- 2026-10-25 02:55: The camera page and the deck were orange in
  production: the old page stylesheet carried its own copy of the colour
  tokens, and the production build loaded it after the shared tokens.
  It now imports the shared tokens itself, so every page has one source
  of colour in any build.

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
