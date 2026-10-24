<div align="center">

# Kilukkam · കിലുക്കം

**Kilukkam turns a room full of devices into an orchestra - one
conductor, an entry code, and every tap plays the next note of a
classical piece together.**

One person conducts. Everyone else joins with a 4-letter code and gets
an instrument. Every tap plays the next note of your part: a
hundred-device handbell choir playing Pachelbel in your living room.

</div>

## How it works

```
Conductor                          Players
─────────                          ───────
1. Pick a piece        ──code──▶   2. Type code, name, avatar
3. Watch the lobby fill            4. Claim a track (or "Surprise me")
5. Tap "Start the piece"           6. One giant button: tap = next note
                                   7. Your phone *is* your instrument
```

There are no skill checks and no timing lanes. The room's humans are
the timing. When the ensemble taps in roughly the same place, it
sounds like music. When it doesn't, it sounds like a party. Both are
correct.

- **Up to 100 players** per room, balanced across the piece's tracks
- **Phones are the instruments**: audio is synthesized locally on each
  device, so the ensemble is literally spatialized around the room
- **Conductor runs the show**: picks the piece, manages the lobby,
  starts and stops the performance
- **Zero install**: open a link on the same WiFi, enter the code

## Pieces

| Piece | Tracks | Feel |
|---|---|---|
| Canon in D, Pachelbel | Violin I·II·III (true canon stagger) + Cello | The demo piece. 24 bars, ~80s |
| Ode to Joy, Beethoven | Flute + Violin + Piano + Cello | Beginner-friendly, all quarter notes |

## Quick start

```sh
npm install
npm run dev --workspace server   # ws server on :8787
npm run dev --workspace web      # vite on :5173, proxies /ws → :8787
```

Then on any phone on the same WiFi, open `http://<your-lan-ip>:5173`.
The conductor opens the same URL on the big screen or their laptop.

## Testing

```sh
npm test          # all workspaces
npm run typecheck # all workspaces
```

## Architecture

- `shared/`: protocol validators, score format, piece library (pure TS)
- `server/`: socket-free `RoomEngine` + thin `ws` adapter (`:8787`)
- `web/`: Vite + vanilla TS client, WebAudio instruments (`:5173`)

The game logic never touches sockets and the audio never touches the
network: the engine is designed to lift into a Cloudflare Durable
Object later, and the client to a static Pages deploy.

See `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, `docs/DECISIONS.md`.
