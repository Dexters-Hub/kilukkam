# Originals and chip voices: integration notes

New files only; nothing owned by others was edited. Apply the edits below to
switch them on.

- `shared/src/pieces/originals/`: `notation.ts` (bar notation and harmony
  helpers), `hallowed-depths.ts`, `boss-rush.ts`, `pixel-plains.ts`, `index.ts`
- `web/src/lib/voices/chip.ts`: the 8-bit voice pack
- `web/tests/originals.test.ts`: tests for both

All three pieces are original compositions (Kilukkam Originals). No
copyrighted melody was transcribed or imitated, and no audio or MIDI file
was added.

## 1. Register the pieces (works today, no other change needed)

`shared/src/pieces/index.ts`:

```ts
import { bossRush, hallowedDepths, pixelPlains } from './originals/index.js';

export { canonInD, odeToJoy, hallowedDepths, bossRush, pixelPlains };

export const PIECES: readonly Score[] = [canonInD, odeToJoy, hallowedDepths, bossRush, pixelPlains];
```

They use only violin, flute, piano and cello, so they play as they are with
the recorded samples and the synth fallback. After registering, run the sync
matrix in `kilukkam-verify` with `--piece hallowed-depths`, `boss-rush` and
`pixel-plains`. Boss Rush has the densest parts (eighths at 150 bpm, 0.2 s
per tap, 522 piano notes).

## 2. Widen InstrumentId with the chip voices

`shared/src/score.ts`:

```ts
export type InstrumentId = 'violin' | 'cello' | 'flute' | 'piano' | 'chip-lead' | 'chip-pulse' | 'chip-bass' | 'chip-drums';
const INSTRUMENTS: readonly InstrumentId[] = ['violin', 'cello', 'flute', 'piano', 'chip-lead', 'chip-pulse', 'chip-bass', 'chip-drums'];
```

TypeScript then flags every `Record<InstrumentId, ...>`, and each needs four
entries:

| File | Record | Suggested chip values |
|---|---|---|
| `web/src/lib/samples.ts` | `BANK_NOTES` (via `BankId`) | `[]` for each (no recordings) |
| `web/src/lib/samples.ts` | `BANKS_FOR` | `['chip-lead']` etc. (main bank is empty, so `preloadInstrument` resolves false and the synth plays) |
| `web/src/lib/samples.ts` | `TONE`, `SHAPES` | `pan: 0`, flat shelves; shapes are unused without samples |
| `web/src/lib/audio.ts` | `LEVEL` | lead 1, pulse 0.9, bass 1.2, drums 1 |
| `web/src/lib/music.ts` | `INSTRUMENTS` | labels "Lead", "Pulse", "Bass", "Drums" |
| `web/src/lib/recording.ts` | `GM_PROGRAM` | lead 80, pulse 81, bass 38; drums belong on GM channel 10 |
| `web/src/screens/home.ts` | `ARTICLE` | "a lead", "a pulse", "a bass", "the drums" |
| `web/src/ui/icons.ts` | instrument glyphs | new glyphs on the 256 grid (design rule: no emoji) |

One catch: `BANK_NOTES[bank]` is mapped in `fetchBank`, and
`preloadInstrument` returns false when `BANKS_FOR` is empty. Either way the
synth path is used. Simplest is to skip `preloadInstrument` for chip voices.

## 3. Hook the voices into audio.ts

`web/src/lib/audio.ts`, at the top:

```ts
import { drum, pulse, triangle } from './voices/chip.js';
```

and in `synth`'s switch (every builder takes `(c, dest, f, t0, hold, peak)`,
the same order as the existing builders, and returns the `Built` shape):

```ts
    case 'chip-lead':
      return pulse(c, dest, f, t0, hold, peak, 0.125);
    case 'chip-pulse':
      return pulse(c, dest, f, t0, hold, peak, 0.25);
    case 'chip-bass':
      return triangle(c, dest, f, t0, hold, peak);
    case 'chip-drums':
      return drum(c, dest, f, t0, hold, peak);
```

`drum` picks the kit piece from the pitch using General MIDI numbers: 35 and
36 kick, 37 to 40 snare, 46 open hat, anything else a closed hat. Optionally,
`arpeggio(c, dest, f, t0, hold, peak, [0, 4, 7])` turns one tap into a fast
NES-style major chord; it suits a conductor jingle or a future "chord" seat.

## 4. Pixel Plains on the chip voices (after step 2)

Pixel Plains is written for this mapping. Make a chip copy of the score
instead of changing the orchestral one:

```ts
import { pixelPlains, pixelPlainsDrums } from './originals/index.js';

const CHIP: Record<string, InstrumentId> = { flute: 'chip-lead', violin: 'chip-pulse', piano: 'chip-pulse', cello: 'chip-bass' };

export const pixelPlainsChip: Score = {
  ...pixelPlains,
  id: 'pixel-plains-8bit',
  title: 'Pixel Plains (8-bit)',
  tracks: [
    ...pixelPlains.tracks.map((t) => ({ ...t, instrument: CHIP[t.id] ?? t.instrument })),
    { id: 'drums', name: 'Drums', instrument: 'chip-drums', maxPlayers: 25, events: [...pixelPlainsDrums] },
  ],
};
```

`pixelPlainsDrums` is already exactly as long as the other parts (tested).
Boss Rush also works as an 8-bit piece with the same mapping (violin to
lead, flute to pulse, cello to bass), but it has no drum part yet.

## 5. Openly licensed game music: candidates for the owner to approve

Not downloaded, not committed. A web search turned these up. Every page
failed TLS certificate verification when I tried to open it, so I could not
confirm the licence or length myself. Check each page before use.

| Title | Author | Licence (per search result) | Length | URL |
|---|---|---|---|---|
| MIDI battle theme | tapatilorenzo | CC0 | about 1:04 (BeepBox loop) | https://opengameart.org/content/midi-battle-theme |
| Boss Battle #6 [8-bit] | nene | CC0, MIDI included | not confirmed | https://opengameart.org/content/boss-battle-6-8-bit |
| Sailors Battle - Midi Theme | Doge | CC0, .mid plus MP3 | not confirmed | https://opengameart.org/content/sailors-battle-midi-theme |

The first is a one-minute loop, and game loops like these are often shorter
than the 2 minute minimum the originals meet, so expect to loop or arrange
them into parts. Arranging a CC0 MIDI is fine; credit
the author anyway as a courtesy.
