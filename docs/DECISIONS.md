# Decisions

- **Stack: vanilla TS + Vite**, no framework. Tiny dep surface, maps
  cleanly to Cloudflare Pages later, migration to React stays cheap.
- **Play model: handbell.** Each tap = next note in your track. No
  scrolling lanes, no timing judgement: the room's humans are the
  timing. Chosen with the owner.
- **100 participants** (owner req). Tracks are limited per piece; many
  players share one track. Auto-accept on join; conductor kicks rather
  than hand-approving (approving 100 people is bad UX).
- **Server: Node + `ws`** for local dev. Game logic lives in a
  socket-free `RoomEngine` so a Durable Object can host it later.
- **Audio: WebAudio synth voices** per instrument family (no sample
  assets in v1, which keeps bundle at ~0 and avoids CDN dependency on same
  WiFi). Samples are a later upgrade behind the same `Instrument`
  interface.
- **Pieces shipped:** Canon in D (4 tracks, true canon stagger) and
  Ode to Joy (4 tracks, beginner-friendly). Scores are code, not JSON
  files, so canon offsets are computed not duplicated.
- **Same-WiFi story:** for local demo, Vite dev server binds 0.0.0.0
  and phones hit the LAN IP; `ws` server likewise. No deploy yet.
- **No auth, no persistence.** Rooms are memory-only; code + socket is
  the whole identity. Conductor powers are per-socket, so a refresh loses
  the room. Acceptable for a room-scale demo; noted as known limit.
