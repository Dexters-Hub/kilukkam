---
name: kilukkam-verify
description: Full quality gate for Kilukkam before calling any change done or asking for a commit. Runs typecheck and tests in every workspace, the no-em-dash check, the multi-phone sync matrix against a real server (1 conductor with 1, 2, 5, 25, 100 phones, drops, 4x stress), and phone-sized light and dark screenshots of the screens you touched. Use after any change to shared/, server/ or web/, before a commit or push, or when someone asks "is it working", "test it", "check everything".
---

# Kilukkam verify

Kilukkam is a live instrument: a hiccup is a wrong note in front of a room.
Nothing is "done" until every step below has run and its result is reported
with the actual command and numbers. Never summarise a step you did not run.

## 1. Static gate (always)

```sh
npm run typecheck          # all workspaces, must print no "error TS"
npm test                   # shared, server, web: report each count
npm run check:dashes       # must exit 0: zero em or en dashes anywhere (owner rule)
```

## 2. Sync matrix (any change to shared/, server/, net, store or play logic)

Run against your own server on a spare port so you test the current source
and never disturb a teammate's dev server:

```sh
PORT=8899 HOST=127.0.0.1 npx tsx server/src/index.ts &   # stop it afterwards
for p in 1 2 5 25 100; do npm run sim -- --url ws://127.0.0.1:8899/ws --players $p --piece ode-to-joy --json; done
for p in 1 2 5 25 100; do npm run sim -- --url ws://127.0.0.1:8899/ws --players $p --piece canon-in-d --json; done
npm run sim -- --url ws://127.0.0.1:8899/ws --players 5  --piece canon-in-d --drop 2 --json
npm run sim -- --url ws://127.0.0.1:8899/ws --players 25 --piece ode-to-joy --drop 5 --json
npm run sim -- --url ws://127.0.0.1:8899/ws --players 100 --piece ode-to-joy --speed 4 --jitter 40 --json
```

Every line must be `"pass": true`. What pass means (see `scripts/room-sim.ts`):
zero missing, duplicate or out-of-order notes; ensemble_pulse totals equal the
notes sent; every chord beat lands in time; no wrong pitches; no ghost players
after drops; no server errors or unexpected closes; p99 echo latency under
50 ms. Report the table (players, notes, latency p50/p99/max, chords in time).

## 3. Screens on a phone (any change to web/)

The web dev server must be running (`npm run dev --workspace web`, port 5173,
plus a room server on 8787). Drive real flows with `npm run shot -- <script.json>`:

```json
{ "width": 390, "height": 844, "dark": false, "steps": [
  { "goto": "http://localhost:5173/" }, { "wait": 1200 },
  { "shot": "/tmp/home.png", "full": true },
  { "tab": 1 }, { "goto": "http://localhost:5173/?code=ABCD" }, { "wait": 1200 },
  { "eval": "document.querySelector('#name').value = 'Anu'; 1" }
]}
```

- Use one `tab` per phone to play conductor plus players in one browser.
- Scroll the page in an `eval` before full-page shots so scroll reveals fire.
- Repeat with `"dark": true`.
- Read every screenshot and check it against the `kilukkam-design` checklist.
- The script prints console errors and exceptions under `logs`; there must be none.

## 4. Report

State each step's command and result. If a step could not run, say so and why.
Then, and only then, ask the coordinator (Devin) to commit and push. Workers
never run git add, commit or push themselves.
