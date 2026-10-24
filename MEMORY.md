# MEMORY

Session ledger for Kilukkam so work survives context resets.

## Status — 2026-10-24

- Monorepo scaffolded: `shared` (done, green), `server` + `web`
  dispatched to Orca workers.
- Shared contracts frozen: `docs/PROTOCOL.md` v1 — do not extend
  without bumping `PROTOCOL_VERSION` and updating both sides.
- Pieces: `canon-in-d`, `ode-to-joy` live in `shared/src/pieces/`.

## Decisions

See `docs/DECISIONS.md`. Short version: vanilla TS + Vite, handbell
tap model, 100 players/room, auto-accept + conductor kick, in-memory
rooms, WebAudio synth voices.

## Locked rules (from owner)

- Never mention the private inspiration projects anywhere in repo,
  code, comments, commits, docs.
- Commits authored as the repo owner (Alwin John), professional style.
- Local-first: no deploy, no external services, no secrets in repo.

## Open threads

- [ ] Worker A (`server/`) — in flight
- [ ] Worker B (`web/`) — in flight
- [ ] Playwright e2e: conductor + 2 players full loop
- [ ] Conductor screen live `note_echo` ripple visualization
- [ ] QR code for join link (nice-to-have, post-MVP)
- [ ] Sampled instruments upgrade (post-MVP)
