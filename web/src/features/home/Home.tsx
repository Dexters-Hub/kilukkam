import { CODE_LEN, PIECES, type InstrumentId } from '@kilukkam/shared';
import { useGSAP } from '@gsap/react';
import { useRef, useState } from 'react';
import { marquee, revealOnScroll, swapText } from '../../lib/anim.js';
import { COMPOSERS } from '../../data/composers.js';
import { isCompleteCode, normalizeCode } from '../../lib/store.js';
import type { IconName } from '../../ui/icons.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { Notice, Screen, Wordmark } from '../../components/Screen.js';
import { INSTRUMENT_ORDER, TryPad } from './TryPad.js';
import s from './Home.module.css';

// The landing page is the game: a playable instrument above the fold and a
// game-PIN box to jump into a room. Words are kept to a minimum.

const TRY_PIECE_ID = 'ode-to-joy';
const ARTICLE: Record<InstrumentId, string> = { violin: 'a violin', flute: 'a flute', piano: 'a piano', cello: 'a cello' };

const STRIP: readonly { icon: IconName; label: string }[] = [
  { icon: 'magic-wand', label: 'One conducts' },
  { icon: 'qr-code', label: 'Everyone joins' },
  { icon: 'hand-tap', label: 'The room plays' },
];

/** Kahoot-style game PIN right on the landing page. */
function PinBox({ onCode }: { onCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const complete = isCompleteCode(code);
  return (
    <div className={s.pin}>
      <span className={s.pinLabel}>Got a code?</span>
      <input
        className={s.pinInput}
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={CODE_LEN + 2}
        placeholder="CODE"
        aria-label="Room code"
        value={code}
        onChange={(e) => {
          const n = normalizeCode(e.target.value);
          setCode(n);
          if (isCompleteCode(n)) onCode(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && complete) onCode(code);
        }}
      />
      <button type="button" className={s.pinGo} aria-label="Join this room" disabled={!complete} onClick={() => onCode(code)}>
        <Icon name="arrow-right" size={24} />
      </button>
    </div>
  );
}

export function Home() {
  const notice = useStore((st) => st.notice);
  const [instrument, setInstrument] = useState<InstrumentId>(INSTRUMENT_ORDER[0] ?? 'violin');
  const piece = PIECES.find((p) => p.id === TRY_PIECE_ID);
  const word = useRef<HTMLSpanElement>(null);
  const legends = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const stop = legends.current ? marquee(legends.current) : () => {};
    if (root.current) revealOnScroll(root.current.querySelectorAll('[data-reveal]'));
    return stop;
  }, []);

  const pick = (id: InstrumentId) => {
    setInstrument(id);
    if (word.current) swapText(word.current, ARTICLE[id]);
  };

  return (
    <Screen className={s.home}>
      <div ref={root} className={s.flow}>
        <header className={s.top}>
          <Wordmark />
          <Button variant="pill" onClick={actions.goCreate}>
            <Icon name="magic-wand" size={18} />
            Conduct
          </Button>
        </header>
        <div className={s.notice}>
          <Notice text={notice} />
        </div>
        <h1 className={s.heroTitle}>
          Your phone is{' '}
          <span ref={word} className={s.heroWord}>
            {ARTICLE[INSTRUMENT_ORDER[0] ?? 'violin']}
          </span>
          .
        </h1>
        <TryPad piece={piece} instrument={instrument} onInstrument={pick} />
        <PinBox onCode={(code) => actions.goJoin(code)} />
        <p className={s.alt}>
          No code yet?{' '}
          <Button variant="link" onClick={actions.goCreate}>
            Start a room as the conductor
            <Icon name="caret-right" size={14} />
          </Button>
        </p>
        <ol className={s.strip} aria-label="How it plays" data-reveal>
          {STRIP.map((step) => (
            <li key={step.label}>
              <span className={s.stripIcon}>
                <Icon name={step.icon} size={30} />
              </span>
              {step.label}
            </li>
          ))}
        </ol>
        <section className={s.legend} aria-label="Composer avatars" data-reveal>
          <h2 className={s.sectionTitle}>Play as a legend</h2>
          <div className={s.legendWindow} aria-hidden="true">
            <div ref={legends} className={s.legendTrack}>
              {[...COMPOSERS, ...COMPOSERS].map((c, i) => (
                <span key={`${c.id}-${i}`} className={s.legendItem}>
                  <Avatar id={c.id} size="md" />
                  {c.displayName}
                </span>
              ))}
            </div>
          </div>
        </section>
        <p className={s.foot}>
          <Icon name="speaker-high" size={18} />
          Volume up, ringer on.
        </p>
      </div>
    </Screen>
  );
}
