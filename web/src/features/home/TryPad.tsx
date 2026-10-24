import { PIECES, type InstrumentId, type Score } from '@kilukkam/shared';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { playNote, preloadInstrument, unlockAudio } from '../../lib/audio.js';
import { INSTRUMENTS, hitName } from '../../lib/music.js';
import { advanceCursor, skipRests } from '../../lib/store.js';
import { useKeyPlay } from '../../app/useKeyPlay.js';
import { cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { HeroDevices, type HeroDevicesHandle } from './HeroDevices.js';
import s from './Home.module.css';

export const INSTRUMENT_ORDER: readonly InstrumentId[] = ['violin', 'guitar', 'flute', 'piano', 'cello', 'drums'];

const tint = (id: InstrumentId) => ({ '--tint': INSTRUMENTS[id].color }) as CSSProperties;
/** A mouse or trackpad: there is a keyboard to play with too */
const laptop = (): boolean => matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The playable room on the landing page: pick your instrument, then every tap
 * (or space bar) plays its next real note and lights your section of the
 * orchestra. Taps never go through React; they paint straight into refs.
 */
export function TryPad({ piece, instrument, onInstrument }: { piece: Score | undefined; instrument: InstrumentId; onInstrument: (id: InstrumentId) => void }) {
  const cursor = useRef(0);
  const played = useRef(0);
  const scene = useRef<HeroDevicesHandle>(null);
  const [nextLabel, setNextLabel] = useState('C4');
  const captionRef = useRef<HTMLParagraphElement>(null);
  /** The part to play: from the home piece, or (drums) the first piece that has one. */
  const sourceFor = (id: InstrumentId): { piece: Score; events: Score['tracks'][number]['events'] } | null => {
    const from = [piece, ...PIECES].find((p) => p?.tracks.some((t) => t.instrument === id));
    const track = from?.tracks.find((t) => t.instrument === id);
    return from && track ? { piece: from, events: track.events } : null;
  };
  const eventsFor = (id: InstrumentId) => sourceFor(id)?.events ?? [];

  const paint = () => {
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor.current);
    const first = events.slice(at).find((e) => e.kind === 'note');
    setNextLabel(first?.kind === 'note' ? hitName(instrument, first.midi) : '♪');
    const n = played.current;
    if (captionRef.current) {
      const label = INSTRUMENTS[instrument].label.toLowerCase();
      captionRef.current.textContent =
        n === 0 ? (laptop() ? 'Click the stage or press space to play.' : 'Tap the stage to play.') : n < 8 ? `${sourceFor(instrument)?.piece.title ?? 'The'}, the ${label} part. Keep going.` : 'Now picture a hundred phones doing this.';
    }
  };

  useEffect(() => {
    cursor.current = 0;
    void preloadInstrument(instrument);
    paint();
    // paint reads the instrument this effect is keyed on
  }, [instrument]);

  const play = () => {
    unlockAudio();
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor.current);
    const ev = events[at];
    const src = sourceFor(instrument);
    if (!ev || ev.kind !== 'note' || !src) {
      cursor.current = 0;
      paint();
      return;
    }
    playNote(instrument, ev.midi, ev.beats, src.piece.bpm, ev.velocity);
    navigator.vibrate?.(8);
    scene.current?.hit(hitName(instrument, ev.midi));
    played.current++;
    const next = advanceCursor(events, at);
    cursor.current = next >= events.length ? 0 : next;
    paint();
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    play();
  };
  useKeyPlay(play);

  return (
    <section className={s.stage} aria-label="Try it" style={tint(instrument)}>
      <div className={s.tabs} role="tablist" aria-label="Instrument">
        {INSTRUMENT_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={cx(s.tab, id === instrument && s.on)}
            aria-selected={id === instrument}
            aria-label={INSTRUMENTS[id].label}
            style={tint(id)}
            onClick={() => {
              if (id !== instrument) onInstrument(id);
            }}
          >
            <Icon name={id} size={24} />
            <span>{INSTRUMENTS[id].label}</span>
          </button>
        ))}
      </div>
      <button type="button" className={s.scene} aria-label="Play the next note" onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
        <HeroDevices ref={scene} mine={instrument} next={nextLabel} />
      </button>
      <p ref={captionRef} className={s.caption} />
    </section>
  );
}
