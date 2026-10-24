# Changelog

All notable changes, newest first. Times are IST (UTC+05:30). Entries
before the docs commit are backfilled from `git log`.

## Unreleased

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
