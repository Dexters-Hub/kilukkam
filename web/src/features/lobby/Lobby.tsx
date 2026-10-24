import { PIECES, type InstrumentId, type PlayerSnapshot, type RoomSnapshot, type Score } from '@kilukkam/shared';
import { useGSAP } from '@gsap/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { popInNew } from '../../lib/anim.js';
import { warmHandModel } from '../../lib/camera/hands.js';
import { playNote, unlockAudio } from '../../lib/audio.js';
import { useKeyPlay } from '../../app/useKeyPlay.js';
import { hitName, instrumentMeta } from '../../lib/music.js';
import { nextEvents, playersByTrack } from '../../lib/store.js';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button, cx } from '../../components/Button.js';
import { CodeBlock } from '../../components/CodeBlock.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import { Dock, Hint, Screen, TopBar } from '../../components/Screen.js';
import { chosenPlayAlong } from '../../app/playalong.js';
import { PLAYALONG_ID } from '../../lib/spotify/playalong.js';
import { Cover } from '../create/Cover.js';
import { NowPlaying } from '../create/NowPlaying.js';
import { PopNumber } from '../../components/PopNumber.js';
import { Roster } from './Roster.js';
import { SeatingChart } from './SeatingChart.js';
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
  const song = chosenPlayAlong();
  const groups = playersByTrack(snap.players);
  const count = snap.players.filter((p) => !p.conductor).length;
  const unassigned = groups.get(null) ?? [];
  const root = usePopIn(snap.players);
  // The conductor may pick up the camera on stage: fetch hand tracking while the room fills.
  useEffect(warmHandModel, []);
  return (
    <>
      <div ref={root} className={s.desk}>
        <div className={s.left}>
          <CodeBlock code={snap.code} conductor />
          {song && piece.id === PLAYALONG_ID ? <NowPlaying track={song.track} compact /> : null}
          <div className={s.pieces} role="radiogroup" aria-label="Piece">
            {PIECES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === piece.id}
                className={cx(s.pieceChip, p.id === piece.id && s.on)}
                onClick={() => {
                  if (p.id !== piece.id) actions.setPiece(p.id);
                }}
              >
                <span className={s.thumb}>
                  <Cover piece={p} playing={p.id === piece.id} />
                </span>
                <span className={s.grow}>
                  <strong>{p.title}</strong>
                  <span className={s.small}>{p.composer}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className={s.right}>
          <div className={s.chartHead}>
            <h2 className={s.chartTitle}>
              {count === 0 ? (
                'Waiting for the first phone…'
              ) : (
                <>
                  <PopNumber value={count} /> {count === 1 ? 'phone' : 'phones'} in the room
                </>
              )}
            </h2>
            <span className={s.muted}>
              {count} of {snap.maxPlayers}
            </span>
          </div>
          <SeatingChart piece={piece} players={snap.players.filter((p) => !p.conductor)} />
          <Hint>Drag anyone below to move them to another instrument.</Hint>
          <div className={s.rosters}>
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
        </div>
      </div>
      <Dock>
        <StartControls players={count} label="Start the piece" />
      </Dock>
    </>
  );
}

/** Tap with the pulse while the room fills: four in a row and you are ready. Plays your instrument's first note. */
function WarmUp({ bpm, instrument, midi }: { bpm: number; instrument: InstrumentId; midi: number }) {
  const [streak, setStreak] = useState(0);
  const start = useRef(performance.now());
  const period = 60_000 / bpm;
  const tap = () => {
    unlockAudio();
    playNote(instrument, midi, 0.5, bpm, 70);
    const phase = ((performance.now() - start.current) % period) / period;
    const off = Math.min(phase, 1 - phase) * period;
    setStreak((n) => (off < 160 ? n + 1 : 0));
  };
  useKeyPlay(tap);
  const ready = streak >= 4;
  return (
    <button type="button" className={cx(s.warm, ready && s.ready)} style={{ '--period': `${period}ms` } as CSSProperties} onPointerDown={(e) => { e.preventDefault(); tap(); }}>
      <span className={s.pulse} aria-hidden="true">
        {ready ? <Icon name="check" size={26} /> : 'TAP'}
      </span>
      <span className={s.grow}>
        <strong>{ready ? 'You are ready' : 'Warm up while you wait'}</strong>
        <span className={s.small}>{ready ? 'Nice timing. Keep it for the real thing.' : `Tap with the pulse. ${streak}/4 in a row.`}</span>
      </span>
    </button>
  );
}

function PlayerLobby({ snap, piece, playerId }: { snap: RoomSnapshot; piece: Score; playerId: string | null }) {
  const groups = playersByTrack(snap.players);
  const mine = snap.players.find((p) => p.id === playerId)?.trackId ?? null;
  const track = piece.tracks.find((t) => t.id === mine);
  const first = nextEvents(track?.events ?? [], 0, 1)[0];
  const others = snap.players.filter((p) => !p.conductor);
  const asked = useRef(false);
  // Straight in: a player with no instrument yet is given one, and can swap below.
  useEffect(() => {
    if (!mine && !asked.current && snap.phase === 'lobby') {
      asked.current = true;
      actions.autoAssign();
    }
  }, [mine, snap.phase]);
  const m = track ? instrumentMeta(track.instrument) : null;
  return (
    <div className={cx(s.body, 'stack')}>
      <section className={s.you} style={m ? tint(m.color) : undefined} aria-live="polite">
        <span className={s.youKicker}>{track ? 'You are playing' : 'Finding you a seat…'}</span>
        <span className={s.youName}>{track?.name ?? '…'}</span>
        <span className={s.youSub}>
          {first
            ? `${piece.title} · first ${track?.instrument === 'drums' ? 'hit' : 'note'} ${hitName(track?.instrument ?? '', first.note.midi)}${first.restBefore > 0 ? ` after ${first.restBefore} beats` : ''}`
            : piece.title}
        </span>
        {track ? (
          <span className={s.youIcon} aria-hidden="true">
            <Icon name={instrumentIcon(track.instrument)} size={120} />
          </span>
        ) : null}
      </section>
      <div className={s.swap} role="group" aria-label="Swap instrument">
        {piece.tracks
          .filter((t) => t.id !== mine)
          .map((t) => {
            const full = (groups.get(t.id)?.length ?? 0) >= t.maxPlayers;
            return (
              <button key={t.id} type="button" className={s.swapChip} style={tint(instrumentMeta(t.instrument).color)} disabled={full} onClick={() => actions.pickTrack(t.id)}>
                <Icon name={instrumentIcon(t.instrument)} size={18} />
                {full ? `${t.name} (full)` : t.name}
              </button>
            );
          })}
      </div>
      <div className={s.strip}>
        <span className={s.faces}>
          {others.slice(0, 8).map((p) => (
            <Avatar key={p.id} id={p.avatar} name={p.name} size="xs" mine={p.id === playerId} />
          ))}
        </span>
        <span className={s.muted}>{others.length === 1 ? 'Just you so far' : `${others.length} in the room`}</span>
      </div>
      {track && first ? <WarmUp bpm={piece.bpm} instrument={track.instrument} midi={first.note.midi} /> : null}
      <p className={s.waiting}>Waiting for the conductor to start…</p>
      <CodeBlock code={snap.code} conductor={false} />
    </div>
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
