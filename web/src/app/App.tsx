import { useEffect, useLayoutEffect, useRef, type ComponentType } from 'react';
import { screenKey, type ScreenKey } from '../lib/store.js';
import { Toaster } from '../components/Toast.js';
import { Create } from '../features/create/Create.js';
import { Ended } from '../features/ended/Ended.js';
import { Home } from '../features/home/Home.js';
import { Join } from '../features/join/Join.js';
import { Lobby } from '../features/lobby/Lobby.js';
import { Play } from '../features/play/Play.js';
import { Stage } from '../features/stage/Stage.js';
import { onLive } from './live.js';
import { useStore } from './useStore.js';
import s from './App.module.css';

const SCREENS: Record<ScreenKey, ComponentType> = {
  home: Home,
  create: Create,
  join: Join,
  lobby: Lobby,
  play: Play,
  stage: Stage,
  ended: Ended,
};

/** Connection trouble, shown only while we are in (or entering) a room. */
function Banner() {
  const text = useStore((st) => {
    const busy = st.session !== null || st.intent !== null;
    if (!busy || st.conn === 'open') return null;
    return st.conn === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…';
  });
  return text ? (
    <div className={s.banner} role="status">
      {text}
    </div>
  ) : null;
}

/** Round-trip time to the room, painted from pongs without re-rendering. */
function RttPill() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onLive('rtt', (ms) => {
        if (ref.current) ref.current.textContent = `${ms} ms`;
      }),
    [],
  );
  return <div ref={ref} className={s.rtt} aria-hidden="true" />;
}

export function App() {
  const key = useStore(screenKey);
  const inRoom = useStore((st) => st.session !== null && st.conn === 'open');
  const Screen = SCREENS[key];

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.body.dataset.screen = key;
  }, [key]);

  return (
    <>
      <Screen key={key} />
      <Banner />
      {inRoom && key === 'play' ? <RttPill /> : null}
      <Toaster />
    </>
  );
}
