# AGENTS.md

Notes for anyone (human or AI agent) writing code in this repo.

## Layout

- `shared/`: protocol types and validators, score format, pieces. Pure TS.
- `server/`: socket-free `RoomEngine` plus a thin `ws` adapter (`:8787`).
- `web/`: Vite + vanilla TS client with WebAudio instruments (`:5173`).
- `docs/`: architecture, protocol contract, decisions.

## Commands

```sh
npm install
npm run dev --workspace server
npm run dev --workspace web
npm test
npm run typecheck
```

## Code

Keep it simple. Strict TypeScript, small modules, no dead code, no
clever abstractions before they are needed.

- Validate every WebSocket payload with the `@kilukkam/shared` parsers.
- User strings reach the DOM via `textContent` only.
- Game logic stays out of the socket layer; audio stays out of the
  network layer.
- Player-facing copy says "instrument", never "track".
- **No em dashes or en dashes** anywhere: copy, docs, comments, commits.
  Use a colon, comma, semicolon or full stop.

## Every commit

1. Update [CHANGELOG.md](CHANGELOG.md) with a timestamped entry.
2. Update [AI_USAGE.md](AI_USAGE.md) if AI tools did any of the work.
3. Both go in the **same commit** as the change they describe.
4. Run `npm test` and `npm run typecheck` first.

## Cadence

Commit roughly every **30 minutes** of work. Small, working steps beat a
big end-of-day drop, and the history is part of the hackathon evidence.
