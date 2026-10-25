# AI usage

An honest log of how AI tools were used to build Kilukkam. The human
owner (Alwin John) set the product direction, owner rules and design
taste, and reviewed and accepted every change.

## Tools and roles

| Tool | Model | Role |
|---|---|---|
| Devin CLI (by Cognition) | SWE-2 High | Architect, coordinator and verifier. Froze the shared contracts, dispatched and reviewed workers, ran verification, authored the commits. |
| Orca workers (Claude Code) | `claude-opus-5-5` | Server build: `RoomEngine` and the `ws` adapter. |
| Orca workers (Claude Code) | `claude-opus-5-5` | Web build: Vite + vanilla TS client, screens, WebAudio. |
| Orca workers (Claude Code) | `claude-opus-5-5` | Web polish: motion, typography, composer avatars, first-run explainer. |
| Orca workers (Claude Code) | `claude-opus-5-5` | Scale fixes: delete-on-disconnect, `ensemble_pulse`, conductor-only `note_echo`, rate limiting. |
| Orca workers (Claude Code) | `claude-opus-5-5` | UI overhaul and repo-facing docs. |
| Self-directed QA / demo agent | `claude-opus-5-5` | End-to-end verification, `MEMORY.md` upkeep, demo page. |
| playwright-mcp | (driven by the coordinator) | Browser end-to-end runs: conductor plus players, full create, join, play, stop loop. |

## How the work was split

- The coordinator owned `shared/` contract changes and `docs/PROTOCOL.md`,
  so workers built against a frozen interface.
- Each worker owned a directory while active, to avoid conflicting edits.
- Every change was verified with `npm test`, `npm run typecheck` and, for
  UI work, a playwright-mcp run before being committed.

## What humans did

- Picked the idea, the track and the name.
- Set the owner rules (no em dashes, no visible borders, composer
  avatars, phones first) recorded in `MEMORY.md`.
- Reviewed output, played it on real phones, and made the final calls.

## Log

| Time (IST) | Commit | AI involvement |
|---|---|---|
| 2026-10-24 20:01 | `96f9b39` | Coordinator scaffolded the monorepo and froze shared contracts. |
| 2026-10-24 20:55 | `f91f319` | Server worker built `RoomEngine`, `ws` adapter and 36 unit tests. |
| 2026-10-24 21:15 | `f8a8f16` | Web build, web polish and scale-fix workers; e2e verified by coordinator. |
| 2026-10-24 21:23 | `d79e619` | Conductor dynamics and section mute. |
| 2026-10-24 21:51 | `764aedf` | Custom-piece upload, conductor dynamics UI, no-em-dash sweep. |
| 2026-10-24 (pending) | | Orca worker wrote README, hackathon docs and PR template. |
| 2026-10-24 23:55 | (pending) | Claude worker built the Spotify play-along flow (browse, tap the beat, room sync) and its sync maths tests. |
| 2026-10-25 01:30 | (pending) | Claude session (QA lead) did the brand and flow revamp, camera conducting on stage, auto finish and results card; a Claude worker rebuilt the play screen visuals with 7 lane tests. |
| 2026-10-25 02:00 | (pending) | Claude session built drums, target scoring, cue zones, levels and the hero product shot; a Claude worker built two-hands lanes with 12 tests. |
| 2026-10-25 02:30 | (pending) | Claude session built the guitar voice, now-playing card, touch play, hand sides and live conducting checks; a Claude worker arranged four public-domain pieces with guitar parts and 47 tests. |
| 2026-10-25 02:44 | (pending) | Claude session found the missing hand model on the live site and made the build fetch it, and cleaned up the roster actions. |
| 2026-10-25 03:30 | (pending) | Claude session found why camera practice levels stopped advancing and fixed the level-up rule. |
| 2026-10-25 03:34 | (pending) | Claude worker built the Piano Tiles levels, holds, flicks, four-lane assignment and glass tile renderer with new level tests; the Claude session reviewed it. |
| 2026-10-25 04:10 | (pending) | Claude session locked the Spotify tab as Coming soon at the owner's request. |
| 2026-10-25 04:25 | (pending) | Claude session compared RIT Kutty, RIT Ala and Karumbi on a numbered sheet; the owner picked RIT Ala and Claude swapped it in. |
| 2026-10-25 04:36 | (pending) | Claude session measured the wordmark against the logo in the browser and centred it. |
| 2026-10-25 04:40 | (pending) | Claude worker reproduced the camera ending a live piece, wrote the failing test, and built the owner-approved ten-gesture camera conductor with false-positive tests, pause, resume and Kilukkam (protocol, engine, phones), the stage readouts and the ten-gesture `?camdemo` run. |
| 2026-10-25 04:54 | (pending) | Claude session lowered the tap line to the Piano Tiles position and cleared the overlays beneath it, checked on a phone viewport. |
| 2026-10-25 04:56 | (pending) | Claude session drew every icon on one sheet, found the duotone tints, and removed them. |
| 2026-10-25 04:58 | (pending) | Claude session moved Start camera beside the heading and fixed the see-through header and the phone top bar. |
| 2026-10-25 05:12 | (pending) | Claude session added the all-levels-cleared finale and Play again, checked with the demo hand. |
| 2026-10-25 05:24 | (pending) | Claude session traced the slow camera start to a late 11 MB download and no browser caching, and added the background warm-up and cache headers. |
| 2026-10-25 05:58 | (pending) | Claude worker built the room leaderboard (ranking, parser limits, one bounded tally per player, phone reporting, podium and placement screens) with shared and server tests, and checked it with a conductor and four phones in the browser. |
| 2026-10-25 06:06 | (pending) | Claude session built room sound, the take recorder, offline render and replay card, and the in-sync headphones orchestra, and tested them in a four-device room. |
| 2026-10-25 06:08 | (pending) | Claude session updated the README, in-repo deck and home page copy. |
