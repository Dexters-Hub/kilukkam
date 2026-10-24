# MEMORY

Session ledger for Kilukkam so work survives context resets. Update after
every milestone.

## What we're building

Hackathon entry for track **"4. Make room for play"**: build something
people want to *experience*, a game played across everyone's phones in the
room. Kilukkam turns a room of up to 100 phones into an orchestra. One
conductor opens a room, friends join with a 4-letter code, each picks an
instrument, and every tap plays that phone's next note. The humans are the
timing. It must be fun, intuitive, and understandable in 3 seconds.

## Status — 2026-10-24

- `shared/` green: protocol v1 + validators, score format, Canon in D and
  Ode to Joy. `MAX_AVATAR_LEN` raised to 24 for composer ids. The protocol
  is gaining `ensemble_pulse` (~4 Hz per-track tap counts to everyone) and
  `room_closed` (sent before sockets close).
- `server/` green (committed `f91f319`): socket-free `RoomEngine` + thin
  `ws` adapter on :8787, path `/ws`.
- `web/` green, uncommitted: Vite + vanilla TS SPA on :5173 (proxies `/ws`).
  Screens: home, create, join, lobby, play, stage (conductor), ended.
  WebAudio synth voices, GSAP motion, composer avatars, Space Grotesk and
  Inter fonts, first-run coach-mark.

## Owner rules (locked)

- Never mention the private inspiration projects anywhere in the repo,
  code, comments, commits, or docs.
- Commits authored as the repo owner (Alwin John), professional style.
- Local-first: no deploy, no external services, no secrets in repo.
- **Zero visible borders/outlines** anywhere. Separation comes from surface
  colour, radius and soft shadow. Focus is an accent glow, never a 1px line.
- Motion through **GSAP**, tasteful and light, and it honours
  `prefers-reduced-motion`.
- Avatars are **great composers** (Bach … Clara Schumann, A.R. Rahman)
  rendered as monogram discs, not generic emoji.
- Typography: modern and minimal. Space Grotesk for display, Inter for
  body, system Malayalam fallback for the wordmark.
- First-time clarity: a 3-step explainer on home, a micro-hint on every
  screen, and copy that says "instrument", never "track".
- Modern, idiomatic, strict TS. User strings via `textContent` only. No dead
  code.
- Phones first: tap targets ≥ 64px, safe areas, no hover-only affordances.

## Known issues / decisions in flight

- Ghost players: disconnected players are never removed, so a flaky phone
  multiplies in the roster. Fix: delete on disconnect, and allow re-picking
  an instrument mid-piece so a dropped phone can rejoin.
- `note_echo` fan-out is 100× per tap. Fix: raw echoes go to the conductor
  only, everyone else gets the `ensemble_pulse` aggregate.
- Room close was silent; `room_closed` fixes it.
- `set_piece` is accepted from `ended` and returns to the lobby. The web
  ended screen should offer "Choose another piece".

## Ownership (Orca run `run_86dcc70d4f45`)

- Coordinator: Devin. Owns `shared/` contract changes and docs/PROTOCOL.md.
- Ensemble worker (`term_8671aecb`): server scale fixes plus web handling
  of `ensemble_pulse` / `room_closed`. Owns `server/` and `web/` while
  active.
- QA lead + gap owner (`term_61bc4fb3`): e2e verification, MEMORY.md
  upkeep, the demo/presentation page (`docs/demo/`). Small web gaps wait
  until the ensemble worker settles.

## Open threads

- [ ] Server: delete-on-disconnect, mid-piece re-pick, `ensemble_pulse`,
  `room_closed`, echo-to-conductor-only, per-socket rate limit
- [ ] Web: handle `ensemble_pulse` / `room_closed`; ended → "Choose
  another piece"
- [ ] Playwright e2e: conductor + 2 players, full loop
- [ ] Demo / presentation page for the pitch, updated as features land
- [ ] QR code for the join link
- [ ] Sampled instruments upgrade (post-MVP)
