// Convert a MIDI file into a Kilukkam score: prints the arrangement report
// and writes the Score JSON. For public-domain pieces only.
//
//   npx tsx scripts/import-midi.ts in.mid [--title "Minuet in G"] [--composer "J. S. Bach"]
//     [--parts 5] [--max-seconds 300] [--out out.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importMidi, type ImportOptions } from '../web/src/lib/midi/index.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number): string => `${NAMES[midi % 12] ?? '?'}${Math.floor(midi / 12) - 1}`;
const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: 'string' },
      composer: { type: 'string' },
      parts: { type: 'string' },
      'max-seconds': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const input = positionals[0];
  if (!input) {
    console.error('usage: npx tsx scripts/import-midi.ts in.mid [--title "..."] [--composer "..."] [--parts 5] [--max-seconds 300] [--out out.json]');
    process.exit(2);
  }

  const bytes = readFileSync(input);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const opts: ImportOptions = {};
  if (values.title !== undefined) opts.title = values.title;
  if (values.composer !== undefined) opts.composer = values.composer;
  if (values.parts !== undefined) opts.maxParts = Number(values.parts);
  if (values['max-seconds'] !== undefined) opts.maxSeconds = Number(values['max-seconds']);

  const { score, report } = importMidi(buf, opts);

  console.log(`${score.title} (${score.composer})`);
  console.log(`${report.key}, ${report.bpm} bpm, ${score.beatsPerBar} beats a bar, ${report.bars} bars, ${clock(report.durationSec)}`);
  for (const p of report.parts) {
    const players = score.tracks.find((t) => t.id === p.id)?.maxPlayers ?? 0;
    const shift = p.transpose === 0 ? '' : `, moved ${p.transpose > 0 ? 'up' : 'down'} ${Math.abs(p.transpose / 12)} octave(s)`;
    console.log(`  ${p.name.padEnd(9)} ${p.role.padEnd(8)} ${String(p.notes).padStart(5)} notes  ${noteName(p.range.low)} to ${noteName(p.range.high)}  up to ${players} players${shift}`);
  }
  for (const w of report.warnings) console.log(`  note: ${w}`);

  if (values.out) {
    writeFileSync(values.out, `${JSON.stringify(score, null, 2)}\n`);
    console.log(`wrote ${values.out}`);
  }
}

main();
