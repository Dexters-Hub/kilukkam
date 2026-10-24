import { PIECES, type PlayerSnapshot, type RoomSnapshot, type Score, type Track } from '@kilukkam/shared';
import { useGSAP } from '@gsap/react';
import { useRef, type CSSProperties } from 'react';
import { popInNew } from '../../lib/anim.js';
import { instrumentMeta, noteName } from '../../lib/music.js';
import { nextEvents, playersByTrack } from '../../lib/store.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button, cx } from '../../components/Button.js';
import { CodeBlock } from '../../components/CodeBlock.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import { Dock, Hint, Screen, TopBar } from '../../components/Screen.js';
import { Roster } from './Roster.js';
import { StartControls } from './StartControls.js';
import s from './Lobby.module.css';

const tint = (color: string) => ({ '--tint': color }) as CSSProperties;

/** New arrivals pop in (lib/anim); runs after each roster change, never on taps. */
function usePopIn(players: readonly PlayerSnapshot[] | undefined) {
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  useGSAP(() => {
    if (root.current) popInNew(root.current, seen.current);
  }, { dependencies: [players], scope: root });
  return root;
}

function ConductorLobby({ snap, piece }: { snap: RoomSnapshot; piece: Score }) {
  const groups = playersByTrack(snap.players);
  const count = snap.players.filter((p) => !p.conductor).length;
  const unassigned = groups.get(null) ?? [];
  const root = usePopIn(snap.players);
  return (
    <>
      <div ref={root} className={cx(s.body, 'stack')}>
        <CodeBlock code={snap.code} conductor />
        <Hint>Share the code or the QR. Players pick an instrument; drag anyone to move them.</Hint>
        <div className={s.segmented} role="radiogroup" aria-label="Piece">
          {PIECES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === piece.id}
              className={cx(p.id === piece.id && s.on)}
              onClick={() => {
                if (p.id !== piece.id) actions.setPiece(p.id);
              }}
            >
              <strong>{p.title}</strong>
              <span className={s.small}>{p.composer}</span>
            </button>
          ))}
        </div>
        <p className={s.muted}>
          {count} of {snap.maxPlayers} players
        </p>
        {piece.tracks.map((t) => {
          const m = instrumentMeta(t.instrument);
          const ps = groups.get(t.id) ?? [];
          return (
            <Roster
              key={t.id}
              trackId={t.id}
              tracks={piece.tracks}
              tint={m.color}
              capacity={`${ps.length}/${t.maxPlayers}`}
              players={ps}
              title={
                <span className={s.rosterTitle}>
                  <Icon name={instrumentIcon(t.instrument)} size={20} />
                  {t.name}
                </span>
              }
            />
          );
        })}
        {unassigned.length ? <Roster trackId={null} tracks={piece.tracks} tint="var(--muted)" capacity={String(unassigned.length)} players={unassigned} title="Still choosing" /> : null}
      </div>
      <Dock>
        <StartControls players={count} label="Start the piece" />
      </Dock>
    </>
  );
}

function TrackCard({ t, players, mine, myId }: { t: Track; players: readonly PlayerSnapshot[]; mine: boolean; myId: string | null }) {
  const m = instrumentMeta(t.instrument);
  const full = players.length >= t.maxPlayers;
  return (
    <button
      type="button"
      className={cx(s.card, mine && s.mine)}
      style={tint(m.color)}
      disabled={full && !mine}
      aria-pressed={mine}
      onClick={() => {
        if (!mine) actions.pickTrack(t.id);
      }}
    >
      <span className={s.glyph}>
        <Icon name={instrumentIcon(t.instrument)} size={30} />
      </span>
      <span className={s.grow}>
        <strong>{t.name}</strong>
        <span className={s.sub}>{mine ? 'Your instrument' : full ? 'Full' : t.name === m.label ? 'Tap to play this' : m.label}</span>
      </span>
      <span className={s.count}>
        {players.length}/{t.maxPlayers}
      </span>
      {players.length ? (
        <span className={s.avatars}>
          {players.map((p) => (
            <Avatar key={p.id} id={p.avatar} name={p.name} pid={p.id} size="sm" mine={p.id === myId} away={!p.connected} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

function PlayerLobby({ snap, piece, playerId }: { snap: RoomSnapshot; piece: Score; playerId: string | null }) {
  const groups = playersByTrack(snap.players);
  const mine = snap.players.find((p) => p.id === playerId)?.trackId ?? null;
  const track = piece.tracks.find((t) => t.id === mine);
  const first = nextEvents(track?.events ?? [], 0, 1)[0];
  const root = usePopIn(snap.players);
  return (
    <>
      <div ref={root} className={cx(s.body, 'stack')}>
        <CodeBlock code={snap.code} conductor={false} />
        <div className={s.pieceLine}>
          <strong>{piece.title}</strong>
          <span className={s.muted}> · {piece.composer}</span>
        </div>
        <h2 className={s.subtitle}>{mine ? 'Waiting for the conductor to start…' : 'Pick your instrument'}</h2>
        <Hint>
          {first
            ? `You’re set. Your first note is ${noteName(first.note.midi)}${first.restBefore > 0 ? ` after ${first.restBefore} beats of rest` : ''}.`
            : 'Tap an instrument to play it, or let us choose for you.'}
        </Hint>
        {piece.tracks.map((t) => (
          <TrackCard key={t.id} t={t} players={groups.get(t.id) ?? []} mine={mine === t.id} myId={playerId} />
        ))}
      </div>
      <Dock>
        <Button variant="link" onClick={actions.autoAssign}>
          <Icon name={mine ? 'shuffle' : 'sparkle'} size={18} />
          {mine ? 'Shuffle me' : 'Surprise me'}
        </Button>
      </Dock>
    </>
  );
}

export function Lobby() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const conductor = useStore((st) => st.session?.role === 'conductor');
  const playerId = useStore((st) => st.playerId);
  return (
    <Screen className={s.screen}>
      <TopBar
        right={
          <Button variant="ghost" onClick={actions.leave}>
            Leave
          </Button>
        }
      />
      {snap && piece ? conductor ? <ConductorLobby snap={snap} piece={piece} /> : <PlayerLobby snap={snap} piece={piece} playerId={playerId} /> : null}
    </Screen>
  );
}
