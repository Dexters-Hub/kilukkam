import type { InstrumentId, Score, ScoreEvent } from '@kilukkam/shared';
import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { floatNote, ring } from '../../lib/anim.js';
import { playNote, preloadInstrument, unlockAudio } from '../../lib/audio.js';
import { INSTRUMENTS, noteName } from '../../lib/music.js';
import { advanceCursor, skipRests } from '../../lib/store.js';
import { cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import s from './Home.module.css';

export const INSTRUMENT_ORDER: readonly InstrumentId[] = ['violin', 'flute', 'piano', 'cello'];

const tint = (id: InstrumentId) => ({ '--tint': INSTRUMENTS[id].color }) as CSSProperties;

/**
 * The playable stage: instrument tabs and a big pad playing that instrument's
 * real part. Taps never go through React: the pointer handler plays the note
 * and paints the note names straight into refs.
 */
export function TryPad({ piece, instrument, onInstrument }: { piece: Score | undefined; instrument: InstrumentId; onInstrument: (id: InstrumentId) => void }) {
  const cursor = useRef(0);
  const played = useRef(0);
  const padRef = useRef<HTMLButtonElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);
  const nextRef = useRef<HTMLSpanElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const eventsFor = (id: InstrumentId): readonly ScoreEvent[] => piece?.tracks.find((t) => t.instrument === id)?.events ?? [];

  const paint = () => {
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor.current);
    const current = events[at];
    const upcoming = events.slice(at + 1).filter((e) => e.kind === 'note').slice(0, 2);
    if (noteRef.current) noteRef.current.textContent = current?.kind === 'note' ? noteName(current.midi) : '♪';
    nextRef.current?.replaceChildren(
      ...upcoming.map((e) => {
        const span = document.createElement('span');
        span.textContent = e.kind === 'note' ? noteName(e.midi) : '';
        return span;
      }),
    );
    const n = played.current;
    if (captionRef.current) {
      captionRef.current.textContent =
        n === 0 ? 'Tap the circle. That’s the whole game.' : n < 8 ? `Ode to Joy, the ${INSTRUMENTS[instrument].label.toLowerCase()} part. Keep going.` : 'Now picture a hundred phones doing this.';
    }
  };

  useEffect(() => {
    cursor.current = 0;
    void preloadInstrument(instrument);
    paint();
    // paint reads the instrument this effect is keyed on
  }, [instrument]);

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    unlockAudio();
    const events = eventsFor(instrument);
    const at = skipRests(events, cursor.current);
    const ev = events[at];
    if (!ev || ev.kind !== 'note' || !piece) {
      cursor.current = 0;
      paint();
      return;
    }
    playNote(instrument, ev.midi, ev.beats, piece.bpm, ev.velocity);
    navigator.vibrate?.(8);
    if (padRef.current) ring(padRef.current);
    if (floatRef.current) floatNote(floatRef.current);
    played.current++;
    const next = advanceCursor(events, at);
    cursor.current = next >= events.length ? 0 : next;
    paint();
  };

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
            <Icon name={id} size={26} />
            <span>{INSTRUMENTS[id].label}</span>
          </button>
        ))}
      </div>
      <button ref={padRef} type="button" className={s.pad} aria-label="Play the next note" onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
        <div ref={floatRef} className={s.float} aria-hidden="true" />
        <span ref={noteRef} className={s.padNote} />
        <span className={s.padHint}>tap</span>
      </button>
      <span ref={nextRef} className={s.next} aria-hidden="true" />
      <p ref={captionRef} className={s.caption} />
    </section>
  );
}
