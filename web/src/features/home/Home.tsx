import { CODE_LEN, PIECES, type InstrumentId } from '@kilukkam/shared';
import { useGSAP } from '@gsap/react';
import { useRef, useState, type CSSProperties } from 'react';
import { heroIntro, marquee, revealOnScroll, swapText } from '../../lib/anim.js';
import { COMPOSERS } from '../../data/composers.js';
import { INSTRUMENTS } from '../../lib/music.js';
import { isCompleteCode, normalizeCode } from '../../lib/store.js';
import type { IconName } from '../../ui/icons.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button } from '../../components/Button.js';
import { Footer } from '../../components/Footer.js';
import { ThemeToggle } from '../../components/ThemeToggle.js';
import { Icon } from '../../components/Icon.js';
import { Notice, Screen, Wordmark } from '../../components/Screen.js';
import { CameraPreview, StepPreviews } from './Previews.js';
import { INSTRUMENT_ORDER, TryPad } from './TryPad.js';
import s from './Home.module.css';

// The landing page is the game: a playable instrument above the fold and a
// game-PIN box to jump into a room. Words are kept to a minimum.

const TRY_PIECE_ID = 'ode-to-joy';
/** Marquee pace per composer, so the strip glides at the same speed however long the roster grows. */
const LEGEND_SECONDS_EACH = 3.4;
const ARTICLE: Record<InstrumentId, string> = { violin: 'a violin', flute: 'a flute', piano: 'a piano', cello: 'a cello', drums: 'a drum', guitar: 'a guitar' };


const SOURCES: readonly { icon: IconName; label: string; text: string; soon?: boolean }[] = [
  { icon: 'music-notes', label: 'Classics and originals', text: 'Canon in D, Ode to Joy, Spanish Romance, and game-style originals like Boss Rush.' },
  { icon: 'headphones', label: 'Spotify play-along', text: 'Play any song from your playlists; the room keeps the beat and the harmony.', soon: true },
];

/** What is on the way, shown quietly at the side of the tour. */
const SOON: readonly { icon: IconName; label: string; text: string }[] = [
  { icon: 'crown-simple', label: 'Daily challenge', text: 'One piece a day for everyone. Play it solo and climb the global board with just a nickname, no login.' },
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
    const stop = legends.current ? marquee(legends.current, COMPOSERS.length * LEGEND_SECONDS_EACH) : () => {};
    if (root.current) {
      heroIntro(root.current);
      revealOnScroll(root.current.querySelectorAll('[data-reveal]'));
    }
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
          <span className={s.topRight}>
            <Button variant="pill" onClick={actions.goCreate}>
              <Icon name="magic-wand" size={18} />
              Conduct
            </Button>
            <ThemeToggle />
          </span>
        </header>
        <div className={s.notice}>
          <Notice text={notice} />
        </div>
        <div className={s.hero}>
          <div className={s.heroCopy}>
            <h1 className={s.heroTitle}>
              <span className={s.words}>
                <span data-intro="word">Your</span> <span data-intro="word">phone</span> <span data-intro="word">is</span>
              </span>{' '}
              <span data-intro="word" className={s.markerWrap}>
                <span ref={word} data-intro="marker" className={s.heroWord} style={{ '--tint': INSTRUMENTS[instrument].color } as CSSProperties}>
                  {ARTICLE[INSTRUMENT_ORDER[0] ?? 'violin']}
                </span>
                .
              </span>
            </h1>
            <p className={s.lead} data-intro="rise">
              A room full of phones becomes an orchestra. One conductor, one code, and every tap plays the next note, together.
            </p>
            <div data-intro="rise">
              <PinBox onCode={(code) => actions.goJoin(code)} />
            </div>
            <div className={s.or} data-intro="rise" aria-hidden="true">
              <span>or</span>
            </div>
            <button type="button" className={s.host} data-intro="rise" onClick={actions.goCreate}>
              <span className={s.hostIcon}>
                <Icon name="magic-wand" size={22} />
              </span>
              <span className={s.hostText}>
                <strong>Host a room</strong>
                <span>Be the conductor: pick the music, get a code, the room joins in.</span>
              </span>
              <span className={s.hostGo} aria-hidden="true">
                <Icon name="arrow-right" size={20} />
              </span>
            </button>
          </div>
          <div data-intro="stage">
            <TryPad piece={piece} instrument={instrument} onInstrument={pick} />
          </div>
        </div>
        <section className={s.section} aria-labelledby="how" data-reveal>
          <h2 id="how" className={s.sectionTitle}>
            How it plays
          </h2>
          <StepPreviews />
        </section>
        <section className={s.section} aria-labelledby="camera" data-reveal>
          <h2 id="camera" className={s.sectionTitle}>
            Conduct with your hands
          </h2>
          <p className={s.sectionLead}>The laptop camera reads your baton hand. Beat time and the whole room follows you. Video never leaves the laptop.</p>
          <CameraPreview />
          <a className={s.cameraLink} href="/camera.html">
            Try the camera conductor
            <Icon name="arrow-right" size={18} />
          </a>
        </section>
        <section className={s.section} aria-labelledby="songs" data-reveal>
          <h2 id="songs" className={s.sectionTitle}>
            Bring any song
          </h2>
          <ul className={s.steps}>
            {SOURCES.map((src) => (
              <li key={src.label}>
                <span className={s.stepIcon}>
                  <Icon name={src.icon} size={26} />
                </span>
                <span>
                  <strong>
                    {src.label}
                    {src.soon ? <span className={s.soon}>Coming soon</span> : null}
                  </strong>
                  <span className={s.stepText}>{src.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className={s.section} aria-labelledby="soon" data-reveal>
          <h2 id="soon" className={s.sectionTitle}>
            Coming soon
          </h2>
          <ul className={s.steps}>
            {SOON.map((item) => (
              <li key={item.label} className={s.soonItem}>
                <span className={s.stepIcon}>
                  <Icon name={item.icon} size={26} />
                </span>
                <span>
                  <strong>
                    {item.label}
                    <span className={s.soon}>Coming soon</span>
                  </strong>
                  <span className={s.stepText}>{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
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
        <p className={s.tip}>
          <Icon name="speaker-high" size={18} />
          Volume up, ringer on.
        </p>
        <Footer />
      </div>
    </Screen>
  );
}
