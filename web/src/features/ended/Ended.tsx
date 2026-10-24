import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button, cx } from '../../components/Button.js';
import { CodeBlock } from '../../components/CodeBlock.js';
import { Icon } from '../../components/Icon.js';
import { Dock, Hint, Screen, Title, TopBar } from '../../components/Screen.js';
import { StartControls } from '../lobby/StartControls.js';
import s from './Ended.module.css';

export function Ended() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const runNotes = useStore((st) => st.runNotes);
  const conductor = useStore((st) => st.session?.role === 'conductor');
  const players = snap?.players.filter((p) => !p.conductor) ?? [];
  return (
    <Screen className={s.screen}>
      <TopBar
        right={
          <Button variant="ghost" onClick={actions.leave}>
            Leave
          </Button>
        }
      />
      <div className={cx(s.body, 'stack')}>
        <span className={s.bravo}>
          <Icon name="confetti" size={64} />
        </span>
        <Title>Well played</Title>
        {piece ? (
          <p className={s.lede}>
            {piece.title} · {players.length} {players.length === 1 ? 'player' : 'players'}
          </p>
        ) : null}
        {runNotes ? (
          <p className={s.stat}>
            The room played <strong>{runNotes.toLocaleString()}</strong> {runNotes === 1 ? 'note' : 'notes'} together
          </p>
        ) : null}
        {/* Slot for the section leaderboard: piece_results lands here once the protocol carries it. */}
        <div className={s.avatars}>
          {players.slice(0, 60).map((p) => (
            <Avatar key={p.id} id={p.avatar} name={p.name} away={!p.connected} />
          ))}
        </div>
        {conductor ? null : <Hint>Stay on this screen. The conductor may call an encore.</Hint>}
        {snap ? <CodeBlock code={snap.code} conductor={conductor} /> : null}
      </div>
      {conductor ? (
        <Dock>
          <StartControls players={players.length} label="Encore: play it again" />
        </Dock>
      ) : null}
    </Screen>
  );
}
