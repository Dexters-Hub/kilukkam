# Submission: DevDay Kochi Hackathon

## Project name

**Kilukkam** (കിലുക്കം)

## Track

4. MAKE ROOM FOR PLAY

## One-liner

Kilukkam (കിലുക്കം) turns a room full of phones into an orchestra: one
conductor, one entry code, and every tap plays the next note of any
song, together.

## The problem

Most "party" apps put everyone on their own screen. Making music
together usually needs skill, instruments and practice. We wanted the
feeling of an orchestra with none of the barriers.

## What it does

- The conductor opens a room on a laptop or big screen and picks a piece.
- Players scan the QR code or type the 4-letter code, pick a composer
  avatar and an instrument.
- Every tap plays the next note of that phone's part. The room's humans
  are the timing.
- The conductor shapes the performance with dynamics and section mutes,
  records the take, and shares it.

## How it is built

- `shared/`: protocol validators, score format, piece library (pure TS).
- `server/`: socket-free `RoomEngine` behind a thin `ws` adapter.
- `web/`: Vite + vanilla TS, WebAudio synthesis on every phone.
- Up to 100 players per room; taps are aggregated into a 4 Hz
  `ensemble_pulse` so the room stays in sync without flooding phones.
- 141 vitest tests; strict TypeScript.

## Run it

See the [quick start](README.md#quick-start).

## Demo

- Video: _pending_
- Screenshots: `docs/screenshots/` (pending)

## Team

- Alwin John

## AI usage

Disclosed in full in [AI_USAGE.md](AI_USAGE.md).

## What's next

- Sampled instruments
- More pieces and a public library of custom scores
- Hosted rooms (the engine is designed to run in a Durable Object)
