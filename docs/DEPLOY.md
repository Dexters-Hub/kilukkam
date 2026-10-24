# Deploying to Cloudflare

Kilukkam ships as one Worker (`kilukkam`) that serves the built web app
and hosts the room server in Durable Objects. Config lives in
[`wrangler.jsonc`](../wrangler.jsonc) at the repo root; the code is the
`worker/` workspace.

## Shape

```
phone ──/ws──▶ Worker (worker/src/session.ts)
                 │  first create_room / join_room picks the room
                 ├─▶ Registry DO (one instance): reserves a free 4-char code
                 └─▶ Room DO (idFromName(code)): one unchanged RoomEngine, one room
everything else ──▶ ASSETS (web/dist, single-page-application fallback)
```

- **Room DO.** Hosts `server/src/room-engine.ts` as is, holding exactly
  one room. Sockets use the Hibernation API (`acceptWebSocket`,
  `webSocketMessage`, `webSocketClose`, `webSocketError`); each socket's
  engine id rides in `serializeAttachment`. The 4 Hz `ensemble_pulse`
  and the results window run on a 250 ms `setAlarm` loop that only runs
  while the room is playing or a results window is open.
- **Registry DO.** A single SQLite-backed instance. `create_room` reserves
  a free code from `CODE_ALPHABET`; the Room DO releases it when the
  conductor leaves (the room closes).
- **Why the Worker relays.** Phones open a bare `/ws` and only name the
  room in their first frame, so the Worker accepts the socket, reads
  that frame, then relays to the right Room DO. Frames before a room
  (ping, early messages, unknown piece, bad code) are answered by an
  empty `RoomEngine` at the edge, so errors match the Node server exactly.
  Once the room answers `room_created` or `joined`, frames pass through
  verbatim; a refused join drops back to anonymous on the same socket.
- **Same limits as the Node server.** Token bucket of 20 msgs/s with a
  burst of 20 per socket, 256 KB frame cap (close 1009), same-host Origin
  check on the upgrade (403 for cross-site pages).
- **Room state is in memory.** If a Room DO is evicted while sockets are
  still attached, it wakes with an empty engine, sends `room_closed` to
  everyone and frees the code rather than leaving a ghost room. In-room
  phones ping every 4 s, which keeps a live room awake.

## Workers Builds (dashboard)

Connect the GitHub repo under Workers & Pages, then set:

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

No routes block: it deploys to `kilukkam.<account>.workers.dev`. Add a
custom domain later with a `routes` entry (`custom_domain: true`), the
same way kalkandam does. There are no secrets or vars.

## Local loop

```sh
npm install
npm run build                      # web/dist
npx wrangler dev --local --port 8799
# in another terminal: the sync matrix against the Worker
npm run sim -- --url ws://127.0.0.1:8799/ws --players 5 --piece ode-to-joy --json
npm run sim -- --url ws://127.0.0.1:8799/ws --players 25 --piece canon-in-d --drop 5 --json
npm run sim -- --url ws://127.0.0.1:8799/ws --players 100 --piece ode-to-joy --speed 4 --jitter 40 --json
```

`npm run cf:dev` does the build and starts `wrangler dev` in one step.
`wrangler dev` reloads when `shared/` or `server/src/` change, and a
reload drops every room, so do not edit those files mid-run.
Day-to-day UI work still uses `npm run dev` (Vite plus the Node server).
