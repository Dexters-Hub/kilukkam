import { PIECES, type Score } from '@kilukkam/shared';
import { useState, type CSSProperties } from 'react';
import { actions } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Button, cx } from '../../components/Button.js';
import { Icon, instrumentIcon } from '../../components/Icon.js';
import { Screen, TopBar } from '../../components/Screen.js';
import { instrumentMeta } from '../../lib/music.js';
import { Cover } from './Cover.js';
import { clock, durationOf, levelOf, moodOf, seatsOf } from './pieceMeta.js';
import { SpotifyCard } from './SpotifyCard.js';
import { usePreview } from './usePreview.js';
import s from './Create.module.css';

// The music shelf: one big cover for the piece you are looking at, with a
// preview and the button that opens the room, and a shelf of the others.
// Spotify play-along sits on its own tab.

type Tab = 'pieces' | 'spotify';

function PlayButton({ playing, onClick, label }: { playing: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={cx(s.playBtn, playing && s.on)}
      aria-label={playing ? `Stop the preview of ${label}` : `Preview ${label}`}
      aria-pressed={playing}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {playing ? (
        <span className={s.eq} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Icon name="play" size={20} />
      )}
    </button>
  );
}

function Featured({ piece, playing, onPreview }: { piece: Score; playing: boolean; onPreview: () => void }) {
  const busy = useStore((st) => (st.intent?.kind === 'create' ? st.intent.pieceId : null));
  return (
    <section className={s.featured} aria-label={piece.title}>
      <div className={s.hero}>
        <Cover piece={piece} playing={playing} big />
        <div className={s.heroText}>
          <span className={s.tags}>
            <span>{moodOf(piece)}</span>
            <span>{levelOf(piece)}</span>
          </span>
          <h2 className={s.heroTitle}>{piece.title}</h2>
          <span className={s.heroMeta}>
            {piece.composer} · {clock(durationOf(piece))} · {piece.bpm} bpm
          </span>
        </div>
        <PlayButton playing={playing} onClick={onPreview} label={piece.title} />
      </div>
      <ul className={s.parts} aria-label="Instruments">
        {piece.tracks.map((t) => (
          <li key={t.id} style={{ '--tint': instrumentMeta(t.instrument).color } as CSSProperties}>
            <Icon name={instrumentIcon(t.instrument)} size={20} />
            <span className={s.grow}>{t.name}</span>
            <span className={s.muted}>{t.maxPlayers}</span>
          </li>
        ))}
      </ul>
      <Button variant="primary" wide disabled={busy !== null} onClick={() => actions.createRoom(piece.id)}>
        {busy === piece.id ? 'Opening the room…' : 'Open the room'}
        <Icon name="arrow-right" size={20} />
      </Button>
      <span className={s.fits}>Fits up to {seatsOf(piece)} phones. Everyone gets a part.</span>
    </section>
  );
}

export function Create() {
  const [tab, setTab] = useState<Tab>('pieces');
  const [pick, setPick] = useState<string>(PIECES[0]?.id ?? '');
  const preview = usePreview();
  const piece = PIECES.find((p) => p.id === pick) ?? PIECES[0];

  const toggle = (p: Score) => (preview.playing === p.id ? preview.stop() : void preview.play(p));
  const choose = (p: Score) => {
    if (p.id === pick) return;
    setPick(p.id);
    if (preview.playing) void preview.play(p);
  };

  return (
    <Screen className={s.screen}>
      <TopBar onBack={actions.goHome} />
      <header className={s.head}>
        <h1 className={s.title}>What will the room play?</h1>
        <p className={s.sub}>Every phone plays one part of the music. Preview a few, then open the room.</p>
        <div className={s.tabs} role="tablist" aria-label="Music source">
          <button type="button" role="tab" aria-selected={tab === 'pieces'} className={cx(tab === 'pieces' && s.tabOn)} onClick={() => setTab('pieces')}>
            <Icon name="music-notes" size={18} />
            Pieces
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'spotify'}
            className={cx(tab === 'spotify' && s.tabOn)}
            onClick={() => {
              preview.stop();
              setTab('spotify');
            }}
          >
            <span className={s.spot} aria-hidden="true" />
            Any song (Spotify)
          </button>
        </div>
      </header>

      {tab === 'spotify' ? (
        <SpotifyCard />
      ) : piece ? (
        <div className={s.layout}>
          <Featured piece={piece} playing={preview.playing === piece.id} onPreview={() => toggle(piece)} />
          <section className={s.more} aria-label="More pieces">
            <h2 className={s.moreTitle}>More to play</h2>
            <ul className={s.shelf}>
              {PIECES.map((p) => (
                <li key={p.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={p.id === pick}
                    aria-label={`${p.title}, ${moodOf(p)}`}
                    className={cx(s.tile, p.id === pick && s.picked)}
                    onClick={() => choose(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose(p);
                      }
                    }}
                  >
                    <Cover piece={p} playing={preview.playing === p.id} />
                    <span className={s.tileText}>
                      <b>{p.title}</b>
                      <span>
                        {moodOf(p)} · {clock(durationOf(p))}
                      </span>
                    </span>
                    <PlayButton playing={preview.playing === p.id} onClick={() => toggle(p)} label={p.title} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Screen>
  );
}
