# Room games: daily music puzzles only a room can play

Status: approved direction, protocol to follow. Owner: Devin (coordinator).
Design rules in `.claude/skills/kilukkam-design` apply to every screen here.

## Why this exists

Kilukkam's engine already turns a room of phones into one instrument.
Pieces are one way to use it. Daily puzzles are the retention loop:
same puzzle for everyone, six tries, a shareable grid, a streak. Wordle
proved the loop; pitchd, Chordle, MelodEar and Daily Jingle have all
ported it to single-player ear training. None of them can do what we
can: the room is the input device, and the feedback is heard, not just
seen.

So the rule for every mode below: **if it is as good alone on a laptop,
it does not belong here.**

## What we reverse-engineered

| Source | What it does well | What we take | What we leave |
|---|---|---|---|
| Wordle | daily constraint, 6 tries, emoji share grid | all three, verbatim | letters |
| pitchd | harmonic partial credit (octave 2.0, 5th 1.5, 4th 1.25, semitone 1.0 of 2.5); song-association intervals; BPM guesser | the scoring curve as the tile colour ramp; interval mnemonics; a tempo round | random note strings (we use real songs); solo play |
| Chordle / MelodEar / Daily Jingle | note-Wordle with green/amber/grey, piano input | the proven tile semantics | one person on one piano |
| Composerdle | hints cost a try; optional bonus answer doubles points; career score + streak + challenge link | all three mechanics | trivia-only (no playing) |

## The modes

Every mode is one room, one conductor's phone as the host screen (or a
laptop/projector), N player phones. Daily seed is `YYYY-MM-DD` hashed,
so every room in the world gets the same puzzle that day. Endless mode
reseeds per round.

### 1. Thaalam (the headline mode): Wordle where the room is the keyboard

- Hidden phrase: 5 notes from a real song (classical, film, Rahman,
  folk, anything in the song library). Not random strings.
- Setup: the host assigns one note per phone from the key's scale, 7 to
  12 phones, or auto-assigns. Extra players double up (same note,
  louder).
- A guess is five taps in order by the room. The host sees the five
  slots fill left to right as phones tap; a tap submits that slot. A
  wrong-order tap is allowed; that is the game.
- Feedback per slot, Wordle semantics plus pitchd colour ramp: green =
  right note right slot; amber = in the phrase, wrong slot; teal =
  octave or perfect 5th/4th of the right note (pitchd partial credit);
  grey = not in the phrase. The row then **plays back** through the
  phones that hold those notes, so the room hears how close it was.
- Hints cost a try (Composerdle): "play the hidden phrase once more",
  "reveal the song's era", "reveal the first interval".
- Optional bonus (Composerdle): name the song after solving, double
  points.
- Share grid: five coloured note-emoji per row, no spoilers.
- Why it needs a room: nobody has built co-op Wordle where the input is
  a crowd. Arguing about who tapped wrong is the fun.

### 2. Echo: Simon says, across the room

- Host plays a phrase on the room (phones light and sound in sequence).
  The room repeats it by tapping in order. Each round adds one note.
- pitchd exercise 6 (pitch sequence memory) and exercise 4 (melody
  dictation), done physically and socially.
- Scoring: longest clean chain; share as "Echo 9" plus the grid.

### 3. Harmony: sing the third

- Host phone plays a melody line; each player phone shows one target
  note and listens via the mic for the player to **sing** it (pitch
  detection, already needed for the hum-it importer). Diatonic thirds
  first, sixths at hard level.
- pitchd "harmonize by ear": the thing beginners find impossible alone
  because the melody pulls your voice. In a room the pull is the game.
- Green when the room holds a clean chord for one bar.

### 4. Thaala: the tempo round

- A beat plays, stops; every phone taps the tempo; the room's median
  BPM is the answer. pitchd BPM Guesser bands: Perfect 3%, Great 8%,
  Good 15%, Close 25%.
- Bonus: the room must hold the tempo together for 8 bars with no
  click; score the spread.

### 5. Composer: Composerdle, by ear, for a room

- A real recording (public domain) plays through all phones, spatially
  split by section. Six tries to name the composer; piece doubles.
  Hints cost a try. Hard tier strips the famous-work giveaways.
- Pure Composerdle mechanics, but the room votes: a guess submits when
  a majority of phones pick the same name within 10 s.

### 6. Katha: a story the room plays into being (track: "tell stories")

- Host picks a short beat sheet (6 to 8 beats: dawn, journey, storm,
  loss, return). Each section of the room owns a mood: strings, flute,
  drums, pad. The narration advances only when the room produces the
  beat's texture (storm = strings swell and drums roll; dawn = flute
  alone, soft). The engine measures section energy from pulses.
- The world responds to the players: a quiet room gets a slower, darker
  telling; a wild room gets the storm early. Two rooms never tell it
  the same way.
- Malayalam and English beat sheets. Zero theory, zero notes to learn:
  you play a feeling.
- Status: ships after Thaalam and Echo if time allows; otherwise the
  first post-hackathon mode.

## Track fit (DevDay "4. Make room for play")

| Track asks for | Covered by |
|---|---|
| experience, not work | pieces and games only; no utility surface |
| a new way to play | Thaalam (co-op note Wordle, room is the keyboard) |
| make music | pieces, Harmony, Echo, DJ cues, live tempo |
| tell stories | Katha (mode 6) |
| interact with other people | every mode needs the room; Composer votes |
| game across everyone's phones | the whole product |
| world responds to players | Katha; Thaalam rows play back through the room |
| instrument controlled through movement | motion bowing and camera baton (in flight in web/lib) |

Demo priority for judges: pieces, Thaalam, Echo, Katha if ready.
Harmony, Tempo and Composer are depth, not the pitch.

## Product rules

- Any song, not only classical. The song library is `Score` objects;
  MIDI import feeds it; the daily picks from a curated list so the
  phrase is recognisable (owner call: Kochi rooms get Rahman and film
  songs in rotation alongside Bach).
- Daily puzzle is one attempt; endless is unlimited. Career score and
  streak live in localStorage per phone, and the host screen shows the
  room's combined result card.
- Hints and bonuses follow Composerdle exactly: a hint spends a try,
  the optional second answer doubles.
- Scoring ramps follow pitchd exactly so the tile colours teach
  intervals: a teal tile tells you "you were a fifth away", which is a
  music lesson delivered by the game.
- Beginners must be able to play mode 1 and 2 with zero theory. Modes
  3 to 5 are unlocked, not required.

## Protocol additions (Devin owns; worker consumes)

Reuses rooms, codes, seating, tempo anchors, pulses. New:

```
C→S  start_game   { mode: 'thaalam'|'echo'|'harmony'|'tempo'|'composer', seed?: string, level?: 'easy'|'medium'|'hard' }   conductor
S→C  game_state   { mode, round, tries_left, slots: Slot[], history: Row[], phase: 'listen'|'guess'|'reveal'|'done', seed }
C→S  game_tap     { slot?: number, midi?: number, bpm?: number, answer?: string }   player; shape per mode
C→S  game_hint    { kind }   conductor; spends a try
S→C  game_row     { tiles: Tile[], playback: {midi, trackId}[] }   after each submitted guess
S→C  game_result  { score, grid: string, streak, bonusAvailable }
Tile = 'green'|'amber'|'teal'|'grey'
```

The engine judges (so every phone agrees); phones only render and
sound. Seed, phrase bank and judging live in `shared/` so the server
and a future Durable Object share them. All of it TDD in
`server/tests/`.

## Build order

1. Shared: `shared/src/games/` with the phrase bank (start: 40 phrases
   across classical, film, Rahman, folk; each tagged key, era, song),
   daily seed, Thaalam judge (Wordle + pitchd ramp), Echo judge, tempo
   judge. Pure, tested.
2. Server: `start_game`, `game_tap`, `game_hint`, state machine per
   mode, `game_row` playback routing to the phones that hold each note.
3. Web (React tree): host screen (slots, rows, share card), player
   screen (your note, big tap, hear the row), then Echo. Katha next if
   time allows. Tempo, Harmony and Composer after pitch detection and
   recording playback land; they are post-demo.
4. Daily: one attempt per device per day, streak, career score, share.

## Non-goals for the hackathon build

Leaderboards across rooms, accounts, cloud storage of results. The
room's result card and localStorage streaks are enough to demo the
loop.
