# MEMORY

Session ledger for Kilukkam so work survives context resets. Update after
every milestone.

## What we're building

Hackathon entry for track **"4. Make room for play"** (DevDay Exchange
template: github.com/anima-regem/devday-kochi-hackathon-template). Something
people want to *experience*: a game played across everyone's phones in the
room. It must feel like a game or a tool, not a learning platform.

Tagline (owner, verbatim): "Kilukkam (കിലുക്കം) turns a room full of phones
into an orchestra: one conductor, one entry code, and every tap plays the next
note of any song, together."

## Status, 2026-10-24 (evening)

- `shared/` green: protocol v1 + validators, `ensemble_pulse`, `room_closed`,
  conductor dynamics and section mute, custom-piece upload (Devin).
- `server/` green: socket-free `RoomEngine` + `ws` adapter (:8787, `/ws`),
  delete-on-disconnect, mid-piece re-pick, echo to conductor only, token
  bucket, same-origin check.
- `web/` green: Vite SPA (:5173), vanilla TS, mid-overhaul. Sunset palette,
  handbell logo, composer portraits, Phosphor icons, playable home "stage",
  game-PIN join, QR encoder, LAN join links, recording core (WAV/MIDI).
- Sync matrix (`scripts/room-sim.ts`, real server, human jitter): 13/13 pass,
  1 to 100 phones, both pieces, drops and rejoins, 4x stress. Zero missing,
  duplicate or out-of-order notes; every chord in time; p99 ≤ 4.5 ms.
- Commits: 5 local commits by Devin, push authorised by the owner.

## Owner rules (locked)

- Never mention the private inspiration projects anywhere in the repo,
  code, comments, commits, or docs.
- Commits and pushes are done by Devin only, authored as the repo owner
  (Alwin John), after every milestone. Workers never run git add/commit/push.
- No secrets in the repo. Deploys need the owner's explicit confirmation.
- **No em dashes** anywhere. `npm run check:dashes` must pass.
- **Zero visible borders/outlines.** Surface colour, radius, soft shadow.
- **Calm CTAs:** one solid accent pill per view plus a text link. No
  full-width gradient buttons, glow or repeated CTAs.
- Motion through **GSAP**, light, honours `prefers-reduced-motion`.
- Avatars: the 12-composer roster with real portraits (Wikimedia; credits in
  `web/public/composers/CREDITS.md`, A.R. Rahman photo is CC BY-SA 4.0).
- Type: Space Grotesk (display), Inter (body), Nupuram Calligraphy Bold for
  the Malayalam wordmark (OFL). Never clip Malayalam.
- Icons: Phosphor duotone (MIT), vendored; no emoji as UI icons.
- Footer: "Built by Dexters-Hub" + GitHub. No Buy Me a Coffee / Product Hunt.
- Copy: few words, big type, "instrument" never "track".
- Phones first: tap targets ≥ 64px, safe areas, no hover-only affordances.
- Full rule set and review checklist: `.claude/skills/kilukkam-design`.
  Verification gate: `.claude/skills/kilukkam-verify`.

## Decisions

- 2026-10-24: web/ moves to **React 19 + Vite + CSS Modules on design
  tokens** (owner choice). Feature folders under `src/features/`, shared
  components in `src/components/`, framework-free engine in `src/lib/`
  (audio, net, recording, midi, qr, music). The tap path never waits on
  React: gesture handlers call audio directly; live visuals run on refs/GSAP.
- Gestures: tap (written length), hold (sustain), slide up/down (swell),
  wiggle (vibrato), shake (opt-in). Notes are sent on touch-down.
- 2026-10-24: scope widens from classical to **any song** (owner). Song
  input: MIDI upload + auto-arrange, new synth voices (drums, bass, lead,
  pad, marimba, choir, claps), hum it, MP3 to notes (Basic Pitch). Test
  corpus: public-domain classical MIDI (Mutopia). Classical stays the
  signature (composer avatars, Pachelbel demo).
- Playlists (Spotify etc.): metadata + Premium playback only, no notes, so
  songs with notes play as a full ensemble and any other song uses
  play-along mode (conductor mic detects beat + key, phones get rhythm,
  bass and chord parts). Protocol asks (`beat`, mode, queue) sent to Devin.
  Owner creates the Spotify developer app (client ID only, no secret).
- Cloudflare (owner, 2026-10-24): Workers Builds connected to GitHub, free
  workers.dev address first, custom domain later. One Durable Object per
  room (idFromName(code)) hosting the unchanged RoomEngine; static web/dist
  via assets binding. Devin dispatches the worker/ adapter; deploy is gated
  on local wrangler dev + the sim matrix.
- Game music: no copyrighted songs (e.g. Hollow Knight) in the repo or
  built-in pieces. Owner may load their own MIDI locally via the importer.
  Original game-style pieces + an 8-bit voice pack instead.
- Brand: tilted handbell with ringing arcs on the sunset gradient
  (public/icon.svg), simplified favicon.svg for 16 to 32 px, maskable icon,
  og.png share card. Malayalam wordmark in Nupuram Calligraphy.

- Coordinator: Devin. Owns shared/ and server/ contracts, docs/, commits.
- QA lead + web owner (`term_61bc4fb3`): web/ end to end, the pitch deck
  (`web/demo.html`), MEMORY.md, verification and the project skills.

## Open threads

- [ ] web/: React migration, then gestures on the play screen, conductor
  create and lobby (interactive, live), stage console (dynamics, mute),
  ended screen with record, mix and share, MIDI song import UI
- [ ] README launch-grade + template docs (dispatched to a Devin worker)
- [ ] Cloudflare worker/ adapter (dispatched to a Devin worker)
- [ ] Two-phone browser e2e pass on every flow, light and dark
- [ ] Sampled instruments upgrade (post-MVP)
