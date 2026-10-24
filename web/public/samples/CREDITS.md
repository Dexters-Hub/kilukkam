# Instrument samples

Recorded by real players, from **VSCO 2 Community Edition** by Versilian
Studios (Sam Gossner and contributors), released under **CC0 1.0** (public
domain): https://github.com/sgossner/VSCO-2-CE

| Folder | Source | Articulation |
| --- | --- | --- |
| `violin/` | Strings/Solo Violin/Arco Vib (forte) | bowed, with vibrato |
| `cello/` | Strings/Cello Section/susvib (dynamic 3) | sustained section, with vibrato |
| `flute/` | Woodwinds/Flute/expvib | expressive vibrato |
| `piano/` | Keys/Upright Piano (dynamic 2, round robin 1) | upright piano |
| `violin-short/` | Strings/Solo Violin/spic (dynamic 2, round robin 1) | spiccato, for quick notes |
| `violin-soft/` | Strings/Solo Violin/Arco Vib (piano) | soft bowing, for gentle passages |
| `cello-short/` | Strings/Cello Section/spic (dynamic 2, round robin 1) | spiccato, for quick notes |
| `flute-short/` | Woodwinds/Flute/stac (dynamic 2, round robin 1) | staccato, for quick notes |

Processing for the web: downmixed to mono, leading silence trimmed, cut to
1.6 seconds (short strokes) or 3.5 to 5 seconds (sustained) with a short fade, loudness matched across each instrument,
encoded as AAC (32 kHz, 56 kbps). Files are named by MIDI note number; the
player pitch-shifts the nearest sample to the exact note.
