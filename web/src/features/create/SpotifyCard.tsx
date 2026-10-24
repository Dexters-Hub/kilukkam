import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '../../components/Button.js';
import { toast } from '../../components/Toast.js';
import {
  SpotifyApiError,
  type SpotifyPlaylist,
  type SpotifyTrack,
  type SpotifyUser,
  me,
  myPlaylists,
  playlistItems,
  searchTracks,
  spotifyIdFrom,
  track as fetchTrack,
} from '../../lib/spotify/api.js';
import { isLoggedIn, login, logout, spotifyAuth } from '../../lib/spotify/auth.js';
import { PlayAlongSetup } from './PlayAlongSetup.js';
import s from './SpotifyCard.module.css';

// Spotify play-along entry on the create screen: sign in, browse a playlist
// or paste a link, pick a song, then tap its beat in PlayAlongSetup. Every
// string from Spotify reaches the page as React text.

const messageOf = (e: unknown): string => (e instanceof SpotifyApiError ? e.message : 'Something went wrong with Spotify.');

type View = { kind: 'home' } | { kind: 'playlist'; name: string; tracks: SpotifyTrack[] | null } | { kind: 'setup'; track: SpotifyTrack };

const looksLikeLink = (text: string): boolean => /open\.spotify\.com|^spotify:/i.test(text.trim());

export function SpotifyCard() {
  const [signedIn, setSignedIn] = useState(isLoggedIn);
  if (!spotifyAuth().configured) {
    return (
      <section className={s.card} aria-label="Spotify play-along">
        <h2 className={s.name}>Play along to Spotify</h2>
        <span className={s.muted}>Spotify is not switched on for this copy of Kilukkam yet. Pick one of the pieces for now; the host can turn Spotify on by adding the app's Spotify Client ID to the build.</span>
      </section>
    );
  }
  if (!signedIn) return <SignIn />;
  return (
    <Connected
      onSignOut={() => {
        logout();
        setSignedIn(false);
      }}
    />
  );
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const r = await login();
    if (r.kind === 'moving_to_loopback') toast('Moving to 127.0.0.1. Tap sign in again there.');
    if (r.kind !== 'redirecting') setBusy(false);
  };
  return (
    <section className={s.card} aria-label="Spotify play-along">
      <h2 className={s.name}>Play along to Spotify</h2>
      <span className={s.muted}>Play any song from this laptop while the room plays on its beat. Needs Spotify Premium.</span>
      <Button variant="primary" onClick={() => void start()} disabled={busy}>
        {busy ? 'Opening Spotify…' : 'Sign in with Spotify'}
      </Button>
    </section>
  );
}

function Connected({ onSignOut }: { onSignOut: () => void }) {
  const [user, setUser] = useState<SpotifyUser | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    me().then(
      (u) => live && setUser(u),
      (e: unknown) => live && setError(messageOf(e)),
    );
    myPlaylists(6).then(
      (p) => live && setPlaylists(p.items),
      (e: unknown) => live && setError(messageOf(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const openPlaylist = async (id: string, name: string) => {
    setError(null);
    setView({ kind: 'playlist', name, tracks: null });
    try {
      const tracks = await playlistItems(id);
      setView((v) => (v.kind === 'playlist' && v.name === name ? { ...v, tracks } : v));
    } catch (e) {
      setError(messageOf(e));
      setView({ kind: 'home' });
    }
  };

  const openLink = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const playlistId = /playlist/.test(link) ? spotifyIdFrom(link, 'playlist') : null;
    const trackId = playlistId ? null : spotifyIdFrom(link, 'track');
    if (playlistId) {
      setLink('');
      await openPlaylist(playlistId, 'Pasted playlist');
      return;
    }
    if (!trackId) {
      if (looksLikeLink(link)) {
        setError('That is not a Spotify song or playlist link.');
        return;
      }
      // Plain words: search Spotify for songs.
      const query = link.trim();
      setBusy(true);
      setView({ kind: 'playlist', name: `Songs for “${query}”`, tracks: null });
      try {
        const tracks = await searchTracks(query);
        setView((v) => (v.kind === 'playlist' ? { ...v, tracks } : v));
      } catch (err) {
        setError(messageOf(err));
        setView({ kind: 'home' });
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const t = await fetchTrack(trackId);
      setLink('');
      if (t.isPlayable) setView({ kind: 'setup', track: t });
      else setError('Spotify cannot play that song on this account.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (view.kind === 'setup') return <PlayAlongSetup track={view.track} onBack={() => setView({ kind: 'home' })} />;

  return (
    <section className={s.card} aria-label="Spotify play-along">
      <div className={s.head}>
        <h2 className={s.name}>Play along to Spotify</h2>
        <Button variant="link" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
      <span className={s.muted}>{user ? `Connected as ${user.displayName}` : 'Connecting to Spotify…'}</span>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {view.kind === 'playlist' ? (
        <>
          <div className={s.head}>
            <strong className={s.grow}>{view.name}</strong>
            <Button variant="link" onClick={() => setView({ kind: 'home' })}>
              All playlists
            </Button>
          </div>
          {view.tracks === null ? (
            <span className={s.muted}>Loading songs…</span>
          ) : view.tracks.length === 0 ? (
            <span className={s.muted}>No playable songs here. Try another search.</span>
          ) : (
            <ul className={s.list}>
              {view.tracks.map((t, i) => (
                <li key={`${t.id}-${i}`}>
                  <button type="button" className={s.item} disabled={!t.isPlayable} onClick={() => setView({ kind: 'setup', track: t })}>
                    <Cover src={t.albumArt} />
                    <span className={s.grow}>
                      <span className={s.title}>{t.name}</span>
                      <span className={s.sub}>{t.isPlayable ? t.artists.join(', ') : 'Not playable on this account'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <form className={s.row} onSubmit={(e) => void openLink(e)}>
            <input
              className={`${s.field} ${s.grow}`}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Search a song or artist, or paste a link"
              aria-label="Search Spotify or paste a song or playlist link"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="dark" disabled={busy || link.trim() === ''}>
              {looksLikeLink(link) ? 'Open' : 'Search'}
            </Button>
          </form>
          {playlists === null ? (
            !error && <span className={s.muted}>Loading playlists…</span>
          ) : playlists.length === 0 ? (
            <span className={s.muted}>No playlists yet. Paste a song link instead.</span>
          ) : (
            <ul className={s.list}>
              {playlists.map((p) => (
                <li key={p.id}>
                  <button type="button" className={s.item} onClick={() => void openPlaylist(p.id, p.name)}>
                    <Cover src={p.image} />
                    <span className={s.grow}>
                      <span className={s.title}>{p.name}</span>
                      <span className={s.sub}>{`${p.trackCount} songs`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Album or playlist art; the API layer already dropped anything that is not https. */
const Cover = ({ src }: { src: string | null }) =>
  src ? <img className={s.cover} src={src} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <span className={s.cover} />;
