import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { unlockAudio } from './lib/audio.js';
import { isCompleteCode, normalizeCode } from './lib/store.js';
import { CALLBACK_PATH, handleCallback } from './lib/spotify/auth.js';
import { toast } from './components/Toast.js';
import { applyTheme, savedTheme } from './lib/theme.js';
import { App } from './app/App.js';
import { connect, store } from './app/controller.js';

applyTheme(savedTheme());

const root = document.getElementById('app');
if (!root) throw new Error('index.html is missing #app');

// Unlock audio on the very first gesture anywhere, not just on Join.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

// /?code=ABCD links straight to the join screen with the code filled.
const linked = normalizeCode(new URLSearchParams(location.search).get('code') ?? '');
if (isCompleteCode(linked)) store.set({ route: 'join', joinCode: linked });

// Back from Spotify: finish the login first (it also clears the code from the
// URL), so Pick a piece renders already connected.
const spotifyReturn = location.pathname === CALLBACK_PATH
  ? handleCallback(location.href).then((ok) => {
      store.set({ route: 'create' });
      toast(ok ? 'Spotify connected' : 'Spotify sign-in did not finish. Try again.', ok ? 'info' : 'error');
    })
  : Promise.resolve();

void spotifyReturn.finally(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

connect();
