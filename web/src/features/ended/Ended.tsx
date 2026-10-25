import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { countUp } from '../../lib/anim.js';
import { instrumentMeta } from '../../lib/music.js';
import { grade } from '../../lib/rhythm.js';
import { myTrack } from '../../lib/store.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button, cx } from '../../components/Button.js';
import { CodeBlock } from '../../components/CodeBlock.js';
import { Icon } from '../../components/Icon.js';
import { PopNumber } from '../../components/PopNumber.js';
import { Dock, Hint, Screen, TopBar } from '../../components/Screen.js';
import { toast } from '../../components/Toast.js';
import { StartControls } from '../lobby/StartControls.js';
import { Counting, Placement, Podium, RankList } from './Leaderboard.js';
import { Replay } from './Replay.js';
import { shareCard } from './shareCard.js';
import s from './Ended.module.css';

const PRAISE: Record<'S' | 'A' | 'B' | 'C', string> = { S: 'Flawless', A: 'Beautiful', B: 'Nicely done', C: 'Good start' };

/** The room's total, counted up when it scrolls into view. */
function RoomNotes({ notes }: { notes: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) countUp(ref.current, notes);
  }, [notes]);
  return (
    <p className={s.stat}>
      The room played <strong ref={ref}>{notes.toLocaleString()}</strong> {notes === 1 ? 'note' : 'notes'} together
    </p>
  );
}

export function Ended() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const runNotes = useStore((st) => st.runNotes);
  const tally = useStore((st) => st.tally);
  const track = useStore(myTrack);
  const session = useStore((st) => st.session);
  const playerId = useStore((st) => st.playerId);
  const conductor = session?.role === 'conductor';
  const players = snap?.players.filter((p) => !p.conductor) ?? [];
  const results = useStore((st) => st.results);
  const pending = useStore((st) => st.resultsPending);
  const [sharing, setSharing] = useState(false);
  const ranked = results?.players ?? [];
  const mine = ranked.find((p) => p.playerId === playerId);
  /** No scores yet and still waiting: hold a calm placeholder; no scores and done waiting: today's view */
  const counting = pending && !results;

  const total = track?.events.filter((e) => e.kind === 'note').length ?? 0;
  const g = grade(tally.accuracy, total ? tally.notes / total : 0);
  const color = track ? instrumentMeta(track.instrument).color : 'var(--accent)';
  const parts = (['perfect', 'great', 'good', 'miss'] as const).map((k) => ({ k, n: tally[k] }));
  const played = parts.reduce((a, p) => a + p.n, 0);

  const share = async () => {
    if (!track || !piece || !session) return;
    setSharing(true);
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(`--${track.instrument}`).trim() || '#b6f400';
    const r = await shareCard({ name: session.name, piece: piece.title, instrument: track.name, grade: g, tally, roomNotes: runNotes, color: resolved });
    setSharing(false);
    if (r === 'downloaded') toast('Result card saved');
    if (r === 'failed') toast('Could not make the card on this browser.', 'error');
  };

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
        {piece ? <span className={s.kicker}>{piece.title}</span> : null}
        {conductor || !track ? (
          <>
            {ranked.length || counting ? null : (
              <span className={s.bravo}>
                <Icon name="confetti" size={64} />
              </span>
            )}
            <h1 className={s.title}>Well played</h1>
            <p className={s.lede}>
              {players.length} {players.length === 1 ? 'phone' : 'phones'} played together
            </p>
            {counting ? <Counting /> : null}
            {ranked.length && conductor ? <Podium players={ranked} piece={piece} /> : null}
            {conductor ? <Replay /> : null}
            {ranked.length && !conductor ? (
              <>
                <span className={s.heading}>Top 3</span>
                <RankList players={ranked.slice(0, 3)} piece={piece} mine={playerId} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className={cx(s.medal, s[`g${g}`])} style={{ '--tint': color } as CSSProperties}>
              {g}
            </span>
            <h1 className={s.title}>
              {PRAISE[g]}, {session?.name}
            </h1>
            <p className={s.lede}>{track.name}</p>
            {counting ? <Counting /> : null}
            {mine ? <Placement me={mine} of={ranked.length} /> : null}
            <div className={s.stats}>
              <div>
                <b>
                  <PopNumber value={`${Math.round(tally.accuracy)}%`} />
                </b>
                <span>on the beat</span>
              </div>
              <div>
                <b>
                  <PopNumber value={`${tally.bestCombo}×`} />
                </b>
                <span>best combo</span>
              </div>
              <div>
                <b>
                  {tally.notes}/{total}
                </b>
                <span>notes played</span>
              </div>
            </div>
            {played ? (
              <div className={s.breakdown} aria-label="Timing breakdown">
                <div className={s.bar}>
                  {parts.map((p) => (p.n ? <i key={p.k} className={s[p.k]} style={{ flexGrow: p.n }} /> : null))}
                </div>
                <div className={s.legend}>
                  {parts.map((p) => (
                    <span key={p.k}>
                      <i className={s[p.k]} />
                      {p.n} {p.k}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {ranked.length ? (
              <>
                <span className={s.heading}>Top 3</span>
                <RankList players={ranked.slice(0, 3)} piece={piece} mine={playerId} />
              </>
            ) : null}
            <Button variant="dark" wide disabled={sharing} onClick={() => void share()}>
              <Icon name="share-network" size={18} />
              {sharing ? 'Making your card…' : 'Share my card'}
            </Button>
          </>
        )}
        {runNotes ? <RoomNotes notes={runNotes} /> : null}
        {ranked.length ? null : (
          <div className={s.avatars}>
            {players.slice(0, 60).map((p) => (
              <Avatar key={p.id} id={p.avatar} name={p.name} away={!p.connected} mine={p.id === playerId} />
            ))}
          </div>
        )}
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
